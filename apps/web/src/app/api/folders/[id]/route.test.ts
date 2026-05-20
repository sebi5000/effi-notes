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
import { DELETE, GET, PATCH } from './route.ts';

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

describe('GET /api/folders/[id]', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/api/folders/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns the folder by id', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({
      data: { name: 'api-test-detail-folder', ownerId: user.id },
    });
    const res = await GET(new Request(`http://localhost/api/folders/${f.id}`), {
      params: Promise.resolve({ id: f.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe(f.id);
    expect(body.name).toBe('api-test-detail-folder');
  });

  it('404 when missing', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/folders/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('counts shares as expired at request time, not module-load time', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const f = await prisma.folder.create({
      data: { name: 'api-test-detail-expiry', ownerId: owner.id },
    });
    const realNow = Date.now();
    // Share is still active "now" but expires within the hour.
    await makeTestShare({
      folderId: f.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'EDIT',
      expiresAt: new Date(realNow + 60 * 60 * 1000),
    });
    setAuthed(owner);

    // Jump two hours past the share's expiry. A stale module-level `new Date()`
    // would still treat the share as active; a per-request `new Date()` won't.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(realNow + 2 * 60 * 60 * 1000);
    try {
      const res = await GET(new Request(`http://localhost/api/folders/${f.id}`), {
        params: Promise.resolve({ id: f.id }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { shareCount: number };
      expect(body.shareCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PATCH /api/folders/[id]', () => {
  it('renames a folder', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({
      data: { name: 'api-test-rename-old', ownerId: user.id },
    });
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-rename-new' }),
      }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(200);
    const reloaded = await prisma.folder.findUnique({ where: { id: f.id } });
    expect(reloaded?.name).toBe('api-test-rename-new');
  });

  it('rejects moving a folder under one of its own descendants (409)', async () => {
    // Tree: parent → child. Try to reparent `parent` under `child` → cycle.
    const { user } = await makeTestUser();
    setAuthed(user);
    const parent = await prisma.folder.create({
      data: { name: 'api-test-cycle-parent', ownerId: user.id },
    });
    const child = await prisma.folder.create({
      data: { name: 'api-test-cycle-child', ownerId: user.id, parentId: parent.id },
    });
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${parent.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentId: child.id }),
      }),
      { params: Promise.resolve({ id: parent.id }) },
    );
    expect(res.status).toBe(409);
    // Tree must be unchanged on rejection.
    const reloaded = await prisma.folder.findUnique({ where: { id: parent.id } });
    expect(reloaded?.parentId).toBeNull();
  });

  it('rejects self-parent', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({
      data: { name: 'api-test-selfparent', ownerId: user.id },
    });
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentId: f.id }),
      }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid json', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({ data: { name: 'api-test-jsonerr', ownerId: user.id } });
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{x',
      }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on empty patch', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({ data: { name: 'api-test-empty', ownerId: user.id } });
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when missing', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await PATCH(
      new Request('http://localhost/api/folders/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    setUnauthed();
    const res = await PATCH(
      new Request('http://localhost/api/folders/x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'y' }),
      }),
      { params: Promise.resolve({ id: 'x' }) },
    );
    expect(res.status).toBe(401);
  });

  it('sets a folder icon', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({
      data: { name: 'api-test-icon', ownerId: user.id },
    });
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ icon: 'rocket' }),
      }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { icon: string };
    expect(body.icon).toBe('rocket');
    const reloaded = await prisma.folder.findUnique({ where: { id: f.id } });
    expect(reloaded?.icon).toBe('rocket');
  });

  it('rejects an unknown icon key with 400', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({
      data: { name: 'api-test-bad-icon', ownerId: user.id },
    });
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ icon: 'definitely-not-an-icon' }),
      }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('forbids an icon change for a view-only collaborator', async () => {
    const { user: userA } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: userA.id });
    await makeTestShare({
      folderId: folder.id,
      granteeId: userB.id,
      createdById: userA.id,
      access: 'VIEW',
    });
    setAuthed(userB);
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ icon: 'star' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/folders/[id]', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await DELETE(new Request('http://localhost/api/folders/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('deletes an empty folder and writes an audit row', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({
      data: { name: 'api-test-delete-empty', ownerId: user.id },
    });
    const res = await DELETE(new Request(`http://localhost/api/folders/${f.id}`), {
      params: Promise.resolve({ id: f.id }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.folder.count({ where: { id: f.id } })).toBe(0);
    const audits = await prisma.auditLog.findMany({
      where: { action: 'folders.deleted', subject: f.id },
    });
    expect(audits).toHaveLength(1);
  });

  it('returns 409 when folder still contains notes', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const f = await prisma.folder.create({ data: { name: 'api-test-nonempty', ownerId: user.id } });
    await prisma.note.create({
      data: { title: 'api-test-blocker', authorId: user.id, folderId: f.id },
    });
    const res = await DELETE(new Request(`http://localhost/api/folders/${f.id}`), {
      params: Promise.resolve({ id: f.id }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 409 when folder has children', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const parent = await prisma.folder.create({
      data: { name: 'api-test-haschild', ownerId: user.id },
    });
    await prisma.folder.create({
      data: { name: 'api-test-thechild', parentId: parent.id, ownerId: user.id },
    });
    const res = await DELETE(new Request(`http://localhost/api/folders/${parent.id}`), {
      params: Promise.resolve({ id: parent.id }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 when missing', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await DELETE(new Request('http://localhost/api/folders/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/folders/[id] — access control', () => {
  it("returns 403 when user B tries to GET user A's folder", async () => {
    const { user: userA } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: userA.id });
    setAuthed(userB);
    const res = await GET(new Request(`http://localhost/api/folders/${folder.id}`), {
      params: Promise.resolve({ id: folder.id }),
    });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/folders/[id] — access control', () => {
  it("returns 403 when user B tries to rename user A's folder", async () => {
    const { user: userA } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: userA.id });
    setAuthed(userB);
    const res = await PATCH(
      new Request(`http://localhost/api/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-hijacked-name' }),
      }),
      { params: Promise.resolve({ id: folder.id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/folders/[id] — access control', () => {
  it("returns 403 when user B tries to delete user A's folder", async () => {
    const { user: userA } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: userA.id });
    setAuthed(userB);
    const res = await DELETE(new Request(`http://localhost/api/folders/${folder.id}`), {
      params: Promise.resolve({ id: folder.id }),
    });
    expect(res.status).toBe(403);
  });
});
