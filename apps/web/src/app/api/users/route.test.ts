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

const TEST_PREFIX = 'api-test-';

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});

afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/users', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/api/users?q=alice'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorised');
  });

  it('returns 400 when q is missing', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/users'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/users?q='));
    expect(res.status).toBe(400);
  });

  it('returns matching users by displayName', async () => {
    const { user: caller } = await makeTestUser();
    setAuthed(caller);

    // Create a user with a known displayName that can be queried
    const target = await prisma.user.create({
      data: {
        keycloakSub: `${TEST_PREFIX}sub-displaymatch`,
        email: `${TEST_PREFIX}displaymatch@example.invalid`,
        displayName: 'api-test-Alice Wonderland',
        roles: ['user'],
      },
      select: { id: true },
    });

    const res = await GET(new Request('http://localhost/api/users?q=api-test-Alice'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{ id: string; displayName: string | null; email: string }>;
    };
    const ids = body.users.map((u) => u.id);
    expect(ids).toContain(target.id);
  });

  it('returns matching users by email', async () => {
    const { user: caller } = await makeTestUser();
    setAuthed(caller);

    const target = await prisma.user.create({
      data: {
        keycloakSub: `${TEST_PREFIX}sub-emailmatch`,
        email: `${TEST_PREFIX}emailmatch-unique@example.invalid`,
        displayName: 'Some User',
        roles: ['user'],
      },
      select: { id: true },
    });

    const res = await GET(new Request('http://localhost/api/users?q=emailmatch-unique'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{ id: string; displayName: string | null; email: string }>;
    };
    const ids = body.users.map((u) => u.id);
    expect(ids).toContain(target.id);
  });

  it('excludes the caller from results even when they match q', async () => {
    const { user: caller } = await makeTestUser();
    setAuthed(caller);

    // The caller's email starts with 'api-test-' and contains a uuid fragment
    // Query by the known prefix to ensure the caller would match
    const res = await GET(
      new Request(`http://localhost/api/users?q=${encodeURIComponent(caller.email)}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ id: string }> };
    const ids = body.users.map((u) => u.id);
    expect(ids).not.toContain(caller.id);
  });

  it('returns { users: [...] } envelope', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/users?q=somequery'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: unknown };
    expect(Array.isArray(body.users)).toBe(true);
  });
});
