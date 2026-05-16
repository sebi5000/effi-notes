import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('@app/jobs', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, enqueueNotesSnapshot: vi.fn(async () => 'fake-job') };
});

import { _resetForTests, onSocketOpen } from '../yjs/server.ts';
import { processNotesSnapshot } from './notes-snapshot.ts';

const TEST_PREFIX = 'snap-proc-';

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
      displayName: 'Snap',
      roles: ['user'],
    },
  });

class FakeSocket {
  send() {
    /* noop */
  }
  close() {
    /* noop */
  }
}

const fakeJob = (data: { noteId: string; actorId: string | null }) =>
  ({
    id: 'job-1',
    data,
    log: vi.fn(async () => undefined),
  }) as unknown as Parameters<typeof processNotesSnapshot>[0];

beforeEach(async () => {
  _resetForTests();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('processNotesSnapshot', () => {
  it('returns bytes=0 when no live doc exists in memory', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}inactive`, authorId: author.id },
    });
    const result = await processNotesSnapshot(fakeJob({ noteId: note.id, actorId: author.id }));
    expect(result.bytes).toBe(0);
  });

  it('persists the live doc when a session has populated it', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}active`, authorId: author.id },
    });

    // Bring a doc into memory via the socket lifecycle.
    const close = await onSocketOpen({
      noteId: note.id,
      userId: author.id,
      access: 'w',
      socket: new FakeSocket(),
    });

    // Mutate the doc directly (the room caches it via getOrLoadDoc).
    const localDoc = new Y.Doc();
    localDoc.getText('content').insert(0, 'hello');
    const update = Y.encodeStateAsUpdate(localDoc);
    // Apply the update via the server's handleMessage path to populate the cache
    const { encodeUpdate, handleMessage } = await import('../yjs/server.ts');
    await handleMessage(
      { noteId: note.id, userId: author.id, access: 'w', socket: new FakeSocket() },
      encodeUpdate(update),
    );

    const result = await processNotesSnapshot(fakeJob({ noteId: note.id, actorId: author.id }));
    expect(result.bytes).toBeGreaterThan(0);

    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.yjsState).not.toBeNull();
    const history = await prisma.noteHistory.findMany({ where: { noteId: note.id } });
    expect(history.length).toBe(1);
    close();
  });
});
