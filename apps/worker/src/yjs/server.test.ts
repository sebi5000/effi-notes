import { prisma } from '@app/db';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  _resetForTests,
  authenticateUpgrade,
  broadcastToRoom,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
  getDocForNote,
  handleMessage,
  onSocketOpen,
  parseMessage,
} from './server.ts';
import { issueToken } from './token.ts';

// Avoid actually hitting Redis in unit tests — stub the snapshot enqueue.
vi.mock('@app/jobs', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    enqueueNotesSnapshot: vi.fn(async () => 'fake-job'),
  };
});

const SECRET = 'test-secret-must-be-at-least-32-chars-long-yes-really';
const TEST_PREFIX = 'yjs-server-';

const cleanup = async () => {
  await prisma.noteHistory.deleteMany({
    where: { author: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.note.deleteMany({ where: { author: { email: { startsWith: TEST_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
};

const seedUser = async () =>
  prisma.user.create({
    data: {
      keycloakSub: `${TEST_PREFIX}sub-${crypto.randomUUID()}`,
      email: `${TEST_PREFIX}${crypto.randomUUID()}@example.invalid`,
      displayName: 'WS Test',
      roles: ['user'],
    },
  });

class FakeSocket {
  public sent: Uint8Array[] = [];
  public closed = false;
  send(data: Uint8Array): void {
    this.sent.push(new Uint8Array(data));
  }
  close(): void {
    this.closed = true;
  }
}

beforeEach(async () => {
  _resetForTests();
  await cleanup();
});

afterEach(() => {
  _resetForTests();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('authenticateUpgrade', () => {
  it('rejects an unknown path', () => {
    const result = authenticateUpgrade({
      pathname: '/other/x',
      searchParams: new URLSearchParams(),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing token', () => {
    const result = authenticateUpgrade({
      pathname: '/yjs/note-1',
      searchParams: new URLSearchParams(),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('missing-token');
  });

  it('rejects an invalid token', () => {
    const result = authenticateUpgrade({
      pathname: '/yjs/note-1',
      searchParams: new URLSearchParams({ token: 'a:b:c:d' }),
      secret: SECRET,
    });
    expect(result.ok === false && result.reason).toBe('invalid-token');
  });

  it('rejects a token where noteId mismatches the path', () => {
    const token = issueToken({ secret: SECRET, noteId: 'other-note', userId: 'u', access: 'w' });
    const result = authenticateUpgrade({
      pathname: '/yjs/note-1',
      searchParams: new URLSearchParams({ token }),
      secret: SECRET,
    });
    expect(result.ok === false && result.reason).toBe('note-id-mismatch');
  });

  it('accepts a valid token', () => {
    const token = issueToken({ secret: SECRET, noteId: 'note-1', userId: 'user-9', access: 'w' });
    const result = authenticateUpgrade({
      pathname: '/yjs/note-1',
      searchParams: new URLSearchParams({ token }),
      secret: SECRET,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.noteId).toBe('note-1');
      expect(result.userId).toBe('user-9');
    }
  });
});

describe('parseMessage', () => {
  it('returns null on truncated input', () => {
    expect(parseMessage(new Uint8Array())).toBeNull();
    expect(parseMessage(new Uint8Array([0]))).toBeNull();
  });

  it('decodes sync step 1 and step 2', () => {
    const sv = new Uint8Array([1, 2, 3]);
    const decoded = parseMessage(encodeSyncStep1(sv));
    expect(decoded?.kind).toBe('sync-step-1');
    if (decoded?.kind === 'sync-step-1') {
      expect(Array.from(decoded.sv)).toEqual([1, 2, 3]);
    }

    const update = new Uint8Array([9, 8, 7]);
    const d2 = parseMessage(encodeSyncStep2(update));
    expect(d2?.kind).toBe('sync-step-2');
  });

  it('decodes awareness messages', () => {
    const aware = new Uint8Array([1, 4, 5, 6]);
    const decoded = parseMessage(aware);
    expect(decoded?.kind).toBe('awareness');
  });
});

describe('socket lifecycle', () => {
  it('sends an initial sync-step-1 on open', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}lifecycle`, authorId: author.id },
    });
    const sock = new FakeSocket();
    const close = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: sock,
    });
    expect(sock.sent.length).toBe(1);
    const decoded = parseMessage(sock.sent[0] ?? new Uint8Array());
    expect(decoded?.kind).toBe('sync-step-1');
    close();
  });

  it('relays updates to other peers and stores them in the in-memory doc', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}relay`, authorId: author.id },
    });

    const a = new FakeSocket();
    const b = new FakeSocket();
    const closeA = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: a,
    });
    const closeB = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: b,
    });
    a.sent = []; // discard initial sync-step-1

    // Build an update by writing to a local doc and encoding it.
    const local = new Y.Doc();
    local.getText('content').insert(0, 'hi from A');
    const update = Y.encodeStateAsUpdate(local);
    await handleMessage(
      { noteId: note.id, userId: author.id, access: 'w', socket: a },
      encodeUpdate(update),
    );

    // B should have received exactly one relayed update
    expect(b.sent.length).toBe(2); // initial step-1 + relayed update
    const decoded = parseMessage(b.sent[1] ?? new Uint8Array());
    expect(decoded?.kind).toBe('sync-update');

    // The in-memory doc reflects the change
    const doc = getDocForNote(note.id);
    expect(doc?.getText('content').toString()).toBe('hi from A');

    closeA();
    closeB();
  });

  it('responds to sync-step-1 with step-2 + step-1', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}step1`, authorId: author.id },
    });
    // Pre-populate the room's doc with content
    const sock = new FakeSocket();
    const close = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: sock,
    });
    sock.sent = [];

    const local = new Y.Doc();
    local.getText('content').insert(0, 'seed');
    const seedUpdate = Y.encodeStateAsUpdate(local);
    await handleMessage(
      { noteId: note.id, userId: author.id, access: 'w', socket: sock },
      encodeUpdate(seedUpdate),
    );
    sock.sent = [];

    // Now a fresh peer sends sync-step-1
    const empty = new Y.Doc();
    const sv = Y.encodeStateVector(empty);
    await handleMessage(
      { noteId: note.id, userId: author.id, access: 'w', socket: sock },
      encodeSyncStep1(sv),
    );

    // Expect step-2 and step-1 in sock.sent
    const kinds = sock.sent.map((b) => parseMessage(b)?.kind);
    expect(kinds).toContain('sync-step-2');
    expect(kinds).toContain('sync-step-1');
    close();
  });

  it('drops malformed messages without throwing', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}malformed`, authorId: author.id },
    });
    const sock = new FakeSocket();
    const close = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: sock,
    });
    sock.sent = [];

    await handleMessage(
      { noteId: note.id, userId: author.id, access: 'w', socket: sock },
      new Uint8Array([0xff]),
    );
    expect(sock.sent.length).toBe(0);
    close();
  });

  it('removes peer on close and clears the room when last peer leaves', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}cleanup`, authorId: author.id },
    });
    const sock = new FakeSocket();
    const close = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: sock,
    });
    expect(getDocForNote(note.id)).toBeDefined();
    close();
    // Room is emptied — broadcasting now is a no-op
    expect(() => broadcastToRoom(note.id, null, new Uint8Array([0, 0]))).not.toThrow();
  });

  it('drops document updates from read-only (access: r) connections', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}readonly-drop`, authorId: author.id },
    });

    const sock = new FakeSocket();
    const closeA = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'r',
      socket: sock,
    });
    sock.sent = [];

    // Capture the state vector before the attempted update
    const docBefore = getDocForNote(note.id);
    const svBefore = docBefore ? Y.encodeStateVector(docBefore) : new Uint8Array();

    // Build an update from a local doc
    const local = new Y.Doc();
    local.getText('content').insert(0, 'should not appear');
    const update = Y.encodeStateAsUpdate(local);

    await handleMessage(
      { noteId: note.id, userId: author.id, access: 'r', socket: sock },
      encodeUpdate(update),
    );

    // The in-memory doc must NOT have changed
    const docAfter = getDocForNote(note.id);
    const svAfter = docAfter ? Y.encodeStateVector(docAfter) : new Uint8Array();
    expect(Array.from(svAfter)).toEqual(Array.from(svBefore));

    // The text must remain empty
    expect(docAfter?.getText('content').toString()).toBe('');

    // No broadcast should have been sent to this socket
    expect(sock.sent.length).toBe(0);

    closeA();
  });

  it('applies document updates from write (access: w) connections', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}write-allowed`, authorId: author.id },
    });

    const a = new FakeSocket();
    const b = new FakeSocket();
    const closeA = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: a,
    });
    const closeB = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: b,
    });
    a.sent = [];

    // Build an update by writing to a local doc
    const local = new Y.Doc();
    local.getText('content').insert(0, 'write allowed');
    const update = Y.encodeStateAsUpdate(local);

    await handleMessage(
      { noteId: note.id, userId: author.id, access: 'w', socket: a },
      encodeUpdate(update),
    );

    // The in-memory doc should reflect the change
    const doc = getDocForNote(note.id);
    expect(doc?.getText('content').toString()).toBe('write allowed');

    // B should have received the relayed update
    const relayed = b.sent.find((msg) => parseMessage(msg)?.kind === 'sync-update');
    expect(relayed).toBeDefined();

    closeA();
    closeB();
  });
});
