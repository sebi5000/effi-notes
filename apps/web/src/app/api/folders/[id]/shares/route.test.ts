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
  makeTestFolder,
  makeTestShare,
  makeTestUser,
  unauthed,
} from '@/lib/api/test-session.ts';
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

describe('POST /api/folders/[id]/shares', () => {
  it('owner creates a grant, returns 201 with a Share row and AuditLog', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    setAuthed(owner);

    const res = await POST(
      new Request(`http://localhost/api/folders/${folder.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: grantee.id, access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; access: string };
    expect(body.access).toBe('VIEW');

    const shareCount = await prisma.share.count({
      where: { folderId: folder.id, granteeId: grantee.id },
    });
    expect(shareCount).toBe(1);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'shares.granted', subject: body.id },
    });
    expect(audits).toHaveLength(1);
  });

  it('re-POST to same grantee upserts — no duplicate row', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    setAuthed(owner);

    // First POST
    await POST(
      new Request(`http://localhost/api/folders/${folder.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: grantee.id, access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );

    // Second POST with different access
    const res2 = await POST(
      new Request(`http://localhost/api/folders/${folder.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: grantee.id, access: 'EDIT' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );

    expect(res2.status).toBe(201);
    const body = (await res2.json()) as { access: string };
    expect(body.access).toBe('EDIT');

    // Still only 1 row
    const count = await prisma.share.count({
      where: { folderId: folder.id, granteeId: grantee.id },
    });
    expect(count).toBe(1);
  });

  it('VIEW-grantee POST → 403', async () => {
    const { user: owner } = await makeTestUser();
    const { user: viewer } = await makeTestUser();
    const { user: third } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    await makeTestShare({
      folderId: folder.id,
      granteeId: viewer.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(viewer);

    const res = await POST(
      new Request(`http://localhost/api/folders/${folder.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: third.id, access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );

    expect(res.status).toBe(403);
  });

  it('unrelated user POST → 403', async () => {
    const { user: owner } = await makeTestUser();
    const { user: stranger } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    setAuthed(stranger);

    const res = await POST(
      new Request(`http://localhost/api/folders/${folder.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: grantee.id, access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );

    expect(res.status).toBe(403);
  });

  it('POST with granteeId equal to caller → 400', async () => {
    const { user: owner } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    setAuthed(owner);

    const res = await POST(
      new Request(`http://localhost/api/folders/${folder.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: owner.id, access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );

    expect(res.status).toBe(400);
  });

  it('POST with unknown granteeId → 400', async () => {
    const { user: owner } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    setAuthed(owner);

    const res = await POST(
      new Request(`http://localhost/api/folders/${folder.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: 'nonexistent-user-id-xxxxx', access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );

    expect(res.status).toBe(400);
  });

  it('unauthenticated POST → 401', async () => {
    setUnauthed();
    const res = await POST(
      new Request('http://localhost/api/folders/some-folder/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: 'x', access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: 'some-folder' }) },
    );
    expect(res.status).toBe(401);
  });

  it('inheritance: manager of parent folder may POST shares on child folder', async () => {
    const { user: owner } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const parent = await makeTestFolder({ ownerId: owner.id });
    const child = await makeTestFolder({ ownerId: owner.id, parentId: parent.id });

    // Share parent to userB with EDIT
    await makeTestShare({
      folderId: parent.id,
      granteeId: userB.id,
      createdById: owner.id,
      access: 'EDIT',
    });
    setAuthed(userB);

    // userB can manage shares on child (inherits EDIT from parent)
    const res = await POST(
      new Request(`http://localhost/api/folders/${child.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId: grantee.id, access: 'VIEW' }),
      }),
      { params: Promise.resolve({ id: child.id }) },
    );

    expect(res.status).toBe(201);
  });
});

describe('GET /api/folders/[id]/shares', () => {
  it('manager GET lists active grants', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    await makeTestShare({
      folderId: folder.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(owner);

    const res = await GET(new Request(`http://localhost/api/folders/${folder.id}/shares`), {
      params: Promise.resolve({ id: folder.id }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { shares: Array<{ id: string }> };
    expect(body.shares).toHaveLength(1);
  });

  it('non-manager GET → 403', async () => {
    const { user: owner } = await makeTestUser();
    const { user: viewer } = await makeTestUser();
    const { user: stranger } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    await makeTestShare({
      folderId: folder.id,
      granteeId: viewer.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(viewer);

    const res = await GET(new Request(`http://localhost/api/folders/${folder.id}/shares`), {
      params: Promise.resolve({ id: folder.id }),
    });

    expect(res.status).toBe(403);

    // Also test a completely unrelated user
    setAuthed(stranger);
    const res2 = await GET(new Request(`http://localhost/api/folders/${folder.id}/shares`), {
      params: Promise.resolve({ id: folder.id }),
    });
    expect(res2.status).toBe(403);
  });

  it('EDIT-grantee GET → 200', async () => {
    const { user: owner } = await makeTestUser();
    const { user: editor } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    await makeTestShare({
      folderId: folder.id,
      granteeId: editor.id,
      createdById: owner.id,
      access: 'EDIT',
    });
    setAuthed(editor);

    const res = await GET(new Request(`http://localhost/api/folders/${folder.id}/shares`), {
      params: Promise.resolve({ id: folder.id }),
    });

    expect(res.status).toBe(200);
  });

  it('unauthenticated GET → 401', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/api/folders/some-folder/shares'), {
      params: Promise.resolve({ id: 'some-folder' }),
    });
    expect(res.status).toBe(401);
  });

  it('inheritance: manager of parent folder may GET shares on child folder', async () => {
    const { user: owner } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    const parent = await makeTestFolder({ ownerId: owner.id });
    const child = await makeTestFolder({ ownerId: owner.id, parentId: parent.id });

    // Share parent to userB with EDIT
    await makeTestShare({
      folderId: parent.id,
      granteeId: userB.id,
      createdById: owner.id,
      access: 'EDIT',
    });
    setAuthed(userB);

    const res = await GET(new Request(`http://localhost/api/folders/${child.id}/shares`), {
      params: Promise.resolve({ id: child.id }),
    });

    expect(res.status).toBe(200);
  });
});
