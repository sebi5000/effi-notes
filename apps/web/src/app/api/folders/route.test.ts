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
    await prisma.folder.create({ data: { name: 'api-test-A' } });
    await prisma.folder.create({ data: { name: 'api-test-B' } });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folders: Array<{ name: string }> };
    expect(body.folders.map((f) => f.name)).toEqual(
      expect.arrayContaining(['api-test-A', 'api-test-B']),
    );
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
    const parent = await prisma.folder.create({ data: { name: 'api-test-parent' } });
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

  it('returns 400 when parentId does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'api-test-orphan', parentId: 'does-not-exist' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
