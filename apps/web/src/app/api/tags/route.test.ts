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
import { GET, POST } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/tags', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    expect((await GET()).status).toBe(401);
  });
  it('lists all tags alphabetically', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.tag.create({ data: { name: 'api-test-z' } });
    await prisma.tag.create({ data: { name: 'api-test-a' } });
    const body = (await (await GET()).json()) as { tags: Array<{ name: string }> };
    const ours = body.tags.filter((t) => t.name.startsWith('api-test-'));
    expect(ours.map((t) => t.name)).toEqual(['api-test-a', 'api-test-z']);
  });
});

describe('POST /api/tags', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await POST(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on bad json', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on bad name', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'has spaces' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('creates a new tag', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-newtag', color: '#C26A20' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe('api-test-newtag');
  });

  it('returns existing tag (200) on duplicate name', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const initial = await prisma.tag.create({ data: { name: 'api-test-dup' } });
    const res = await POST(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-dup' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(initial.id);
  });
});
