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
import { PUT } from './route.ts';

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

const callPut = (id: string, body: unknown) =>
  PUT(
    new Request(`http://localhost/api/notes/${id}/body`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('PUT /api/notes/[id]/body', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthed();
    const res = await callPut('x', { body: 'new', baseUpdatedAt: new Date().toISOString() });
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid JSON', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await callPut('x', '{nope');
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid body shape', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await callPut('x', { body: 'new' }); // missing baseUpdatedAt
    expect(res.status).toBe(400);
  });

  it('returns 404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await callPut('missing', {
      body: 'new',
      baseUpdatedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(404);
  });

  it('saves the body and returns the new updatedAt when baseUpdatedAt matches', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-body', body: 'old', authorId: user.id },
    });
    const res = await callPut(note.id, {
      body: '# new body',
      baseUpdatedAt: note.updatedAt.toISOString(),
    });
    expect(res.status).toBe(200);
    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.body).toBe('# new body');
    expect(reloaded?.lastEditorId).toBe(user.id);
  });

  it('returns 409 when baseUpdatedAt is stale', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-conflict', body: 'middle', authorId: user.id },
    });
    // Use a deliberately stale base — 1 hour before the actual updatedAt.
    const stale = new Date(note.updatedAt.getTime() - 3_600_000);
    const res = await callPut(note.id, {
      body: '# attempt',
      baseUpdatedAt: stale.toISOString(),
    });
    expect(res.status).toBe(409);
    const payload = (await res.json()) as { error: string; details: { currentUpdatedAt: string } };
    expect(payload.error).toBe('conflict');
    expect(typeof payload.details.currentUpdatedAt).toBe('string');
    // Body must NOT have been overwritten.
    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.body).toBe('middle');
  });
});
