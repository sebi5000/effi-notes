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
import { PATCH } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

const call = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/folders/reorder', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** Create a folder owned by the api-test domain so cleanup catches it. */
const mkFolder = (name: string, parentId: string | null, position: number) =>
  prisma.folder.create({
    data: { name: `api-test-${name}`, parentId, position },
    select: { id: true },
  });

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('PATCH /api/folders/reorder', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await call({ parentId: null, orderedIds: ['x'] });
    expect(res.status).toBe(401);
  });

  it('400 on invalid json', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    expect((await call('{nope')).status).toBe(400);
  });

  it('400 on an empty orderedIds list', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    expect((await call({ parentId: null, orderedIds: [] })).status).toBe(400);
  });

  it('400 on duplicate ids', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const a = await mkFolder('a', null, 0);
    const res = await call({ parentId: null, orderedIds: [a.id, a.id] });
    expect(res.status).toBe(400);
  });

  it('400 when an id does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await call({ parentId: null, orderedIds: ['does-not-exist'] });
    expect(res.status).toBe(400);
  });

  it('reorders siblings, writing contiguous positions in array order', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const a = await mkFolder('a', null, 0);
    const b = await mkFolder('b', null, 1);
    const c = await mkFolder('c', null, 2);

    const res = await call({ parentId: null, orderedIds: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);

    const rows = await prisma.folder.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      select: { id: true, position: true },
    });
    const posOf = (id: string) => rows.find((r) => r.id === id)?.position;
    expect(posOf(c.id)).toBe(0);
    expect(posOf(a.id)).toBe(1);
    expect(posOf(b.id)).toBe(2);
  });

  it('cross-hierarchy move: re-parents the dragged folder under a new parent', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const target = await mkFolder('target', null, 0);
    const child = await mkFolder('child', target.id, 0);
    const loose = await mkFolder('loose', null, 1);

    // Move `loose` into `target`, after the existing child.
    const res = await call({ parentId: target.id, orderedIds: [child.id, loose.id] });
    expect(res.status).toBe(200);

    const moved = await prisma.folder.findUnique({ where: { id: loose.id } });
    expect(moved?.parentId).toBe(target.id);
    expect(moved?.position).toBe(1);
  });

  it('409 when a folder would be moved into its own descendant', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const root = await mkFolder('root', null, 0);
    const mid = await mkFolder('mid', root.id, 0);

    // Try to make `root` a child of its own descendant `mid`.
    const res = await call({ parentId: mid.id, orderedIds: [root.id] });
    expect(res.status).toBe(409);
  });

  it('409 when a folder is moved into itself', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const a = await mkFolder('selfparent', null, 0);
    const res = await call({ parentId: a.id, orderedIds: [a.id] });
    expect(res.status).toBe(409);
  });
});
