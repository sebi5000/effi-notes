import { vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/auth';
import { authedAs, cleanupNotesDomain, makeTestUser, unauthed } from '@/lib/api/test-session.ts';
import { GET } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

const call = (q: string | null) => {
  const url =
    q === null
      ? 'http://localhost/api/search'
      : `http://localhost/api/search?q=${encodeURIComponent(q)}`;
  return GET(new Request(url));
};

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/search', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await call('strategy');
    expect(res.status).toBe(401);
  });

  it('400 when q is missing', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await call(null);
    expect(res.status).toBe(400);
  });

  it('finds notes by a word from the body (tsvector)', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.note.create({
      data: {
        title: 'api-test-strategy-note',
        body: 'Heute haben wir die Strategie für Q3 mit Acme besprochen.',
        authorId: user.id,
      },
    });
    const res = await call('strategie');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Array<{ title: string; snippet: string }> };
    const titles = body.hits.map((h) => h.title);
    expect(titles).toContain('api-test-strategy-note');
  });

  it('hides archived notes from search', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.note.create({
      data: {
        title: 'api-test-search-archived',
        body: 'sometag',
        authorId: user.id,
        archivedAt: new Date(),
      },
    });
    const res = await call('sometag');
    const body = (await res.json()) as { hits: Array<{ title: string }> };
    expect(body.hits.map((h) => h.title)).not.toContain('api-test-search-archived');
  });

  it('falls back to trigram match on title for typos', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.note.create({
      data: {
        title: 'api-test-Strategieworkshop',
        body: '',
        authorId: user.id,
      },
    });
    const res = await call('strategiewrkshop');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Array<{ title: string }> };
    expect(body.hits.map((h) => h.title)).toContain('api-test-Strategieworkshop');
  });

  it('finds a note via an embedded asset filename', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-search-host', body: 'nothing relevant here', authorId: user.id },
    });
    await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'zucchini-harvest.png',
        byteSize: 4,
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    const res = await GET(new Request('http://localhost/api/search?q=zucchini'));
    const body = (await res.json()) as { hits: Array<{ id: string }> };
    expect(body.hits.some((h) => h.id === note.id)).toBe(true);
  });

  it('does not duplicate a note that matches both directly and via an asset', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-rutabaga-note', body: 'about rutabaga', authorId: user.id },
    });
    await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'rutabaga.png',
        byteSize: 4,
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    const res = await GET(new Request('http://localhost/api/search?q=rutabaga'));
    const body = (await res.json()) as { hits: Array<{ id: string }> };
    expect(body.hits.filter((h) => h.id === note.id)).toHaveLength(1);
  });

  it('finds a note via an embedded asset caption', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-caption-host', body: 'unrelated body', authorId: user.id },
    });
    await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'plain.png',
        caption: 'a broccoli closeup',
        byteSize: 4,
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    const res = await GET(new Request('http://localhost/api/search?q=broccoli'));
    const body = (await res.json()) as { hits: Array<{ id: string }> };
    expect(body.hits.some((h) => h.id === note.id)).toBe(true);
  });
});
