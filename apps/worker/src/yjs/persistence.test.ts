import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { loadDocFromDb, saveDocSnapshot } from './persistence.ts';

const TEST_PREFIX = 'yjs-persist-';

const cleanup = async () => {
  await prisma.noteHistory.deleteMany({
    where: { author: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.note.deleteMany({
    where: { author: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
};

const seedUser = async () =>
  prisma.user.create({
    data: {
      keycloakSub: `${TEST_PREFIX}sub-${crypto.randomUUID()}`,
      email: `${TEST_PREFIX}${crypto.randomUUID()}@example.invalid`,
      displayName: 'Yjs Test',
      roles: ['user'],
    },
  });

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('yjs persistence', () => {
  it('loads an empty doc when the note has no yjsState', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}empty`, authorId: author.id },
    });
    const doc = await loadDocFromDb(note.id);
    expect(doc.getText('content').toString()).toBe('');
  });

  it('round-trips a Y.Doc: save then load preserves content', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}round-trip`, authorId: author.id },
    });

    const source = new Y.Doc();
    source.getText('content').insert(0, 'hello collab world');
    const result = await saveDocSnapshot(note.id, source, author.id);
    expect(result.bytes).toBeGreaterThan(0);

    const loaded = await loadDocFromDb(note.id);
    expect(loaded.getText('content').toString()).toBe('hello collab world');

    // History row written for the author
    const history = await prisma.noteHistory.findMany({ where: { noteId: note.id } });
    expect(history.length).toBe(1);
    expect(history[0]?.authorId).toBe(author.id);
  });

  it('saves the yjs state without a history row when actorId is null', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: { title: `${TEST_PREFIX}sys-snapshot`, authorId: author.id },
    });

    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'autosave');
    await saveDocSnapshot(note.id, doc, null);

    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.yjsState).not.toBeNull();
    const history = await prisma.noteHistory.findMany({ where: { noteId: note.id } });
    expect(history.length).toBe(0);
  });

  it('returns bytes=0 when the note has been deleted mid-session', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'orphan');
    const result = await saveDocSnapshot('does-not-exist', doc, null);
    expect(result.bytes).toBe(0);
  });

  it('recovers from a corrupted yjsState by returning an empty doc', async () => {
    const author = await seedUser();
    const note = await prisma.note.create({
      data: {
        title: `${TEST_PREFIX}corrupt`,
        authorId: author.id,
        yjsState: Buffer.from([0xff, 0x00, 0x42]),
      },
    });
    const doc = await loadDocFromDb(note.id);
    expect(doc.getText('content').toString()).toBe('');
  });
});
