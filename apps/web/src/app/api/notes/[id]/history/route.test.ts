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

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/notes/[id]/history', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/api/notes/x/history'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/notes/missing/history'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns history rows newest-first with bodyLength', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-history', body: 'current', authorId: user.id },
    });
    // Explicit, 1-minute-apart timestamps so the newest-first ordering is
    // deterministic — two inserts in the same millisecond would otherwise
    // race on `createdAt`.
    await prisma.noteHistory.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        body: 'v1',
        createdAt: new Date('2026-05-15T10:00:00.000Z'),
      },
    });
    await prisma.noteHistory.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        body: 'v22',
        createdAt: new Date('2026-05-15T10:01:00.000Z'),
      },
    });
    const res = await GET(new Request(`http://localhost/api/notes/${note.id}/history?limit=10`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      history: Array<{ bodyLength: number; createdAt: string }>;
    };
    expect(body.history).toHaveLength(2);
    // Newest first → bodyLength should be 3 (v22) then 2 (v1)
    expect(body.history[0]?.bodyLength).toBe(3);
    expect(body.history[1]?.bodyLength).toBe(2);
  });
});
