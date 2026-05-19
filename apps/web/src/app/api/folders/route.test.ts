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

describe('GET /api/folders', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the full folder list', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.folder.create({ data: { name: 'api-test-A', ownerId: user.id } });
    await prisma.folder.create({ data: { name: 'api-test-B', ownerId: user.id } });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folders: Array<{ name: string }> };
    expect(body.folders.map((f) => f.name)).toEqual(
      expect.arrayContaining(['api-test-A', 'api-test-B']),
    );
  });

  it('tags a folder shared with the user with sharedWithMe', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await prisma.folder.create({
      data: { name: 'api-test-shared-folder', ownerId: owner.id },
    });
    await makeTestShare({
      folderId: folder.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'EDIT',
    });
    setAuthed(grantee);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      folders: Array<{ id: string; sharedWithMe?: { access: string; seenAt: string | null } }>;
    };
    const node = body.folders.find((f) => f.id === folder.id);
    expect(node?.sharedWithMe).toBeDefined();
    expect(node?.sharedWithMe?.access).toBe('EDIT');
    expect(node?.sharedWithMe?.seenAt).toBeNull();
  });

  it("does not tag the owner's own folder with sharedWithMe", async () => {
    const { user } = await makeTestUser();
    const folder = await prisma.folder.create({
      data: { name: 'api-test-own-folder', ownerId: user.id },
    });
    setAuthed(user);
    const res = await GET();
    const body = (await res.json()) as {
      folders: Array<{ id: string; sharedWithMe?: unknown }>;
    };
    expect(body.folders.find((f) => f.id === folder.id)?.sharedWithMe).toBeUndefined();
  });

  it('counts shares as expired at request time, not module-load time', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await prisma.folder.create({
      data: { name: 'api-test-expiry-folder', ownerId: owner.id },
    });
    const realNow = Date.now();
    // Share is still active "now" but expires within the hour.
    await makeTestShare({
      folderId: folder.id,
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
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        folders: Array<{ id: string; shareCount: number }>;
      };
      expect(body.folders.find((f) => f.id === folder.id)?.shareCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/folders', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid json', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on empty name', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('creates a root folder', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-root' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; parentId: null };
    expect(body.name).toBe('api-test-root');
    expect(body.parentId).toBeNull();
    const audits = await prisma.auditLog.findMany({
      where: { action: 'folders.created', subject: body.id },
    });
    expect(audits.length).toBe(1);
  });

  it('creates a child folder when parentId exists', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const parent = await prisma.folder.create({
      data: { name: 'api-test-parent', ownerId: user.id },
    });
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-child', parentId: parent.id }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { parentId: string };
    expect(body.parentId).toBe(parent.id);
  });

  it('returns 403 when parentId does not exist (missing parent = no access)', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-orphan', parentId: 'does-not-exist' }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /api/folders — access control', () => {
  it('excludes folders owned by another user from the list', async () => {
    const { user: userA } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    await makeTestFolder({ ownerId: userA.id });
    setAuthed(userB);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folders: Array<{ name: string }> };
    // userB has no folders — the list should be empty (or at least not contain A's folder)
    const names = body.folders.map((f) => f.name);
    const aFolders = await prisma.folder.findMany({ where: { ownerId: userA.id } });
    for (const af of aFolders) {
      expect(names).not.toContain(af.name);
    }
  });
});

describe('POST /api/folders — access control', () => {
  it("returns 403 when creating a subfolder under another user's folder", async () => {
    const { user: userA } = await makeTestUser();
    const { user: userB } = await makeTestUser();
    const parentFolder = await makeTestFolder({ ownerId: userA.id });
    setAuthed(userB);
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-denied-child', parentId: parentFolder.id }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
