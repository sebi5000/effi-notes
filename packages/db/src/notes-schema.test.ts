import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './index.ts';

const TEST_PREFIX = 'notes-schema-test-';

const cleanup = async (): Promise<void> => {
  // Order matters: child rows first, then notes, then folders, tags, users.
  await prisma.noteHistory.deleteMany({ where: { note: { title: { startsWith: TEST_PREFIX } } } });
  await prisma.noteTag.deleteMany({ where: { note: { title: { startsWith: TEST_PREFIX } } } });
  await prisma.note.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
  await prisma.folder.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.tag.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
};

const seedAuthor = async () =>
  prisma.user.create({
    data: {
      keycloakSub: `${TEST_PREFIX}sub-${crypto.randomUUID()}`,
      email: `${TEST_PREFIX}${crypto.randomUUID()}@example.invalid`,
      displayName: 'Test Author',
      roles: ['user'],
    },
  });

describe('notes schema', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('round-trips Folder → Note → Tag association', async () => {
    const author = await seedAuthor();
    const folder = await prisma.folder.create({
      data: { name: `${TEST_PREFIX}Clients`, position: 0 },
    });
    const tag = await prisma.tag.create({
      data: { name: `${TEST_PREFIX}strategy`, color: '#C26A20' },
    });

    const note = await prisma.note.create({
      data: {
        title: `${TEST_PREFIX}Acme Q3 review`,
        body: '# Heading\nKey risks: vendor lock-in (high)',
        folderId: folder.id,
        authorId: author.id,
        tags: { create: { tagId: tag.id } },
      },
      include: { tags: { include: { tag: true } }, folder: true, author: true },
    });

    expect(note.id).toBeTypeOf('string');
    expect(note.folder?.name).toBe(`${TEST_PREFIX}Clients`);
    expect(note.author.id).toBe(author.id);
    expect(note.tags).toHaveLength(1);
    expect(note.tags[0]?.tag.name).toBe(`${TEST_PREFIX}strategy`);
    expect(note.archivedAt).toBeNull();
    expect(note.createdAt).toBeInstanceOf(Date);
  });

  it('supports nested folders via self-relation', async () => {
    const root = await prisma.folder.create({ data: { name: `${TEST_PREFIX}Clients` } });
    const child = await prisma.folder.create({
      data: { name: `${TEST_PREFIX}Acme`, parentId: root.id },
    });

    const reloaded = await prisma.folder.findUnique({
      where: { id: root.id },
      include: { children: true },
    });
    expect(reloaded?.children).toHaveLength(1);
    expect(reloaded?.children[0]?.id).toBe(child.id);
  });

  it('cascades NoteTag and NoteHistory rows when the parent Note is deleted', async () => {
    const author = await seedAuthor();
    const tag = await prisma.tag.create({ data: { name: `${TEST_PREFIX}pricing` } });
    const note = await prisma.note.create({
      data: {
        title: `${TEST_PREFIX}Pricing memo`,
        body: 'Initial body',
        authorId: author.id,
        tags: { create: { tagId: tag.id } },
        history: { create: { authorId: author.id, body: 'snapshot v1' } },
      },
    });

    await prisma.note.delete({ where: { id: note.id } });

    expect(await prisma.noteTag.count({ where: { noteId: note.id } })).toBe(0);
    expect(await prisma.noteHistory.count({ where: { noteId: note.id } })).toBe(0);
    // The tag itself survives (it's a shared dictionary).
    expect(await prisma.tag.count({ where: { id: tag.id } })).toBe(1);
  });
});

describe('notes search vector', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('finds a note by a word from its body (tsvector)', async () => {
    const author = await seedAuthor();
    await prisma.note.create({
      data: {
        title: `${TEST_PREFIX}Workshop with Acme`,
        body: 'Heute haben wir die Strategie für Q3 mit Acme besprochen.',
        authorId: author.id,
      },
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; title: string }>>(
      `SELECT id, title FROM "Note"
       WHERE title LIKE $1
         AND "searchVector" @@ to_tsquery('simple', $2)`,
      `${TEST_PREFIX}%`,
      'strategie',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe(`${TEST_PREFIX}Workshop with Acme`);
  });

  it('finds a note via pg_trgm fuzzy match on title', async () => {
    const author = await seedAuthor();
    await prisma.note.create({
      data: {
        title: `${TEST_PREFIX}Strategieworkshop`,
        body: '',
        authorId: author.id,
      },
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; title: string }>>(
      `SELECT id, title FROM "Note"
       WHERE title LIKE $1
         AND title % $2`,
      `${TEST_PREFIX}%`,
      'strategiewrkshop',
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
