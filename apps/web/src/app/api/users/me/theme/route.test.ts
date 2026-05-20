import { vi } from 'vitest';

const cookieStore = { get: vi.fn(), set: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
}));

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
import { GET, PUT } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

const putReq = (body: unknown) =>
  new Request('http://localhost/api/users/me/theme', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  mockedAuth.mockReset();
  cookieStore.get.mockReset();
  cookieStore.set.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/users/me/theme', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the default theme for a fresh user', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { theme: string }).theme).toBe('warm-paper');
    // GET reseeds the cookie so subsequent SSR stays cookie-fast.
    expect(cookieStore.set).toHaveBeenCalledWith(
      'effi-notes:theme',
      'warm-paper',
      expect.any(Object),
    );
  });
});

describe('PUT /api/users/me/theme', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await PUT(putReq({ theme: 'dark' }));
    expect(res.status).toBe(401);
  });

  it('400 on an unknown theme value', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await PUT(putReq({ theme: 'not-a-theme' }));
    expect(res.status).toBe(400);
  });

  it('400 on invalid JSON', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await PUT(
      new Request('http://localhost/x', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('updates User.theme and writes the cookie', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await PUT(putReq({ theme: 'dark' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { theme: string }).theme).toBe('dark');

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { theme: true },
    });
    expect(row?.theme).toBe('dark');
    expect(cookieStore.set).toHaveBeenCalledWith('effi-notes:theme', 'dark', expect.any(Object));
  });
});
