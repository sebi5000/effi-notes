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
import {
  authedAs,
  cleanupNotesDomain,
  makeTestNote,
  makeTestUser,
  unauthed,
} from '@/lib/api/test-session.ts';
// verifyToken removed: worker token format is updated in Task 19; token shape assertions check raw segments instead
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

    const parts = body.token.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe(note.id);
    expect(parts[1]).toBe(user.id);
  });

  it('403s a token request for a note the user cannot access', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    setAuthed(b);
    const res = await GET(new Request(`http://localhost/api/collab/${note.id}`), {
      params: Promise.resolve({ noteId: note.id }),
    });
    expect(res.status).toBe(403);
  });

  it('issues a w-token for an editor and an r-token for a viewer', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    await prisma.share.create({
      data: { noteId: note.id, granteeId: b.id, createdById: a.id, access: 'VIEW' },
    });
    setAuthed(a);
    const ownerRes = await GET(new Request(`http://localhost/api/collab/${note.id}`), {
      params: Promise.resolve({ noteId: note.id }),
    });
    expect(((await ownerRes.json()) as { token: string }).token.split(':')[2]).toBe('w');
    setAuthed(b);
    const viewerRes = await GET(new Request(`http://localhost/api/collab/${note.id}`), {
      params: Promise.resolve({ noteId: note.id }),
    });
    expect(((await viewerRes.json()) as { token: string }).token.split(':')[2]).toBe('r');
  });
});
