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
import { DELETE } from './route.ts';

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

describe('DELETE /api/notes/[id]/shares/[shareId]', () => {
  it('owner DELETE revokes any grant, returns 200, row gone, AuditLog exists', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(owner);

    const res = await DELETE(
      new Request(`http://localhost/api/notes/${note.id}/shares/${share.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: note.id, shareId: share.id }) },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { revoked: boolean };
    expect(body.revoked).toBe(true);

    const row = await prisma.share.findUnique({ where: { id: share.id } });
    expect(row).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { action: 'shares.revoked', subject: share.id },
    });
    expect(audits).toHaveLength(1);
  });

  it('EDIT-grantee may DELETE a share they created', async () => {
    const { user: owner } = await makeTestUser();
    const { user: editor } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });

    // Give editor EDIT access on the note
    await makeTestShare({
      noteId: note.id,
      granteeId: editor.id,
      createdById: owner.id,
      access: 'EDIT',
    });

    // Editor creates a share for grantee
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: editor.id,
      access: 'VIEW',
    });
    setAuthed(editor);

    const res = await DELETE(
      new Request(`http://localhost/api/notes/${note.id}/shares/${share.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: note.id, shareId: share.id }) },
    );

    expect(res.status).toBe(200);
  });

  it('EDIT-grantee gets 403 deleting a share created by someone else', async () => {
    const { user: owner } = await makeTestUser();
    const { user: editor } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });

    // Give editor EDIT access
    await makeTestShare({
      noteId: note.id,
      granteeId: editor.id,
      createdById: owner.id,
      access: 'EDIT',
    });

    // Owner creates a share for grantee (not editor)
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(editor);

    const res = await DELETE(
      new Request(`http://localhost/api/notes/${note.id}/shares/${share.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: note.id, shareId: share.id }) },
    );

    expect(res.status).toBe(403);
  });

  it('DELETE of a shareId whose noteId is a different note → 404', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const noteA = await makeTestNote({ authorId: owner.id });
    const noteB = await makeTestNote({ authorId: owner.id });

    // Share is on noteB
    const share = await makeTestShare({
      noteId: noteB.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(owner);

    // But we reference noteA in the URL
    const res = await DELETE(
      new Request(`http://localhost/api/notes/${noteA.id}/shares/${share.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: noteA.id, shareId: share.id }) },
    );

    expect(res.status).toBe(404);
  });

  it('unauthenticated DELETE → 401', async () => {
    setUnauthed();
    const res = await DELETE(
      new Request('http://localhost/api/notes/some-note/shares/some-share', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'some-note', shareId: 'some-share' }) },
    );
    expect(res.status).toBe(401);
  });
});
