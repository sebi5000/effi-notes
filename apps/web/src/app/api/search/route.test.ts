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
});
