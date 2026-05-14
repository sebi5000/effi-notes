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
import { verifyToken } from '../../../../../../worker/src/yjs/token.ts';
import { GET } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

const AUTH_SECRET = 'test-secret-must-be-at-least-32-chars-long';

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/collab/[noteId]', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/api/collab/x'), {
      params: Promise.resolve({ noteId: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/collab/missing'), {
      params: Promise.resolve({ noteId: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns a token that the worker can verify', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-collab', authorId: user.id },
    });
    const res = await GET(new Request(`http://localhost/api/collab/${note.id}`), {
      params: Promise.resolve({ noteId: note.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; url: string; expiresAt: string };
    expect(body.url).toContain('/yjs/');
    expect(body.url).toContain(encodeURIComponent(body.token));

    const parsed = verifyToken({ secret: AUTH_SECRET, token: body.token });
    expect(parsed).not.toBeNull();
    expect(parsed?.noteId).toBe(note.id);
    expect(parsed?.userId).toBe(user.id);
  });
});
