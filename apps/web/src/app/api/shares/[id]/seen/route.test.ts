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
  makeTestShare,
  makeTestUser,
  unauthed,
} from '@/lib/api/test-session.ts';
import { POST } from './route.ts';

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

const req = () => new Request('http://localhost/api/shares/x/seen', { method: 'POST' });

describe('POST /api/shares/[id]/seen', () => {
  it('returns 401 without a session', async () => {
    setUnauthed();
    const res = await POST(req(), { params: Promise.resolve({ id: 'x' }) });
    expect(res.status).toBe(401);
  });

  it('marks an unseen share seen for its grantee', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(grantee);
    const res = await POST(req(), { params: Promise.resolve({ id: share.id }) });
    expect(res.status).toBe(200);
    const reloaded = await prisma.share.findUnique({ where: { id: share.id } });
    expect(reloaded?.seenAt).not.toBeNull();
  });

  it('is idempotent — a second call still returns 200', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(grantee);
    await POST(req(), { params: Promise.resolve({ id: share.id }) });
    const res = await POST(req(), { params: Promise.resolve({ id: share.id }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 for a non-grantee', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const { user: stranger } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(stranger);
    const res = await POST(req(), { params: Promise.resolve({ id: share.id }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown share id', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(req(), { params: Promise.resolve({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });
});
