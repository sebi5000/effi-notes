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

describe('GET /api/notes/[id]', () => {
  it('returns 401 when there is no session', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/api/notes/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/notes/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns the note with body for an existing id', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-detail', body: '# Detail body', authorId: user.id },
    });
    const res = await GET(new Request(`http://localhost/api/notes/${note.id}`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string; body: string };
    expect(body.id).toBe(note.id);
    expect(body.body).toBe('# Detail body');
  });
});

describe('PATCH /api/notes/[id]', () => {
  it('updates title and folderId', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-patch-old', authorId: user.id },
    });
    const folder = await prisma.folder.create({
      data: { name: 'api-test-patch-folder', ownerId: user.id },
    });

    const res = await PATCH(
      new Request(`http://localhost/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'api-test-patch-new', folderId: folder.id }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    expect(res.status).toBe(200);

    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.title).toBe('api-test-patch-new');
    expect(reloaded?.folderId).toBe(folder.id);
    expect(reloaded?.lastEditorId).toBe(user.id);
  });

  it('replaces tags when tagIds is supplied', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const tagA = await prisma.tag.create({ data: { name: 'api-test-tagA' } });
    const tagB = await prisma.tag.create({ data: { name: 'api-test-tagB' } });
    const note = await prisma.note.create({
      data: {
        title: 'api-test-tagswap',
        authorId: user.id,
        tags: { create: { tagId: tagA.id } },
      },
    });

    const res = await PATCH(
      new Request(`http://localhost/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagIds: [tagB.id] }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    expect(res.status).toBe(200);
    const tags = await prisma.noteTag.findMany({ where: { noteId: note.id } });
    expect(tags.map((t) => t.tagId)).toEqual([tagB.id]);
  });

  it('returns 400 with no fields to update', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-empty-patch', authorId: user.id },
    });
    const res = await PATCH(
      new Request(`http://localhost/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when patching a missing note', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await PATCH(
      new Request('http://localhost/api/notes/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid json', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await PATCH(
      new Request('http://localhost/api/notes/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/notes/[id]', () => {
  it('soft-deletes (archives) by default and writes an audit log', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-archive', authorId: user.id },
    });
    const res = await DELETE(new Request(`http://localhost/api/notes/${note.id}`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(200);

    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.archivedAt).toBeInstanceOf(Date);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'notes.archived', subject: note.id },
    });
    expect(audits).toHaveLength(1);
  });

  it('hard-deletes when ?hard=1', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-harddelete', authorId: user.id },
    });
    const res = await DELETE(new Request(`http://localhost/api/notes/${note.id}?hard=1`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.note.count({ where: { id: note.id } })).toBe(0);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'notes.deleted', subject: note.id },
    });
    expect(audits).toHaveLength(1);
  });

  it('returns 404 when archiving a missing note', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await DELETE(new Request('http://localhost/api/notes/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 when there is no session', async () => {
    setUnauthed();
    const res = await DELETE(new Request('http://localhost/api/notes/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});
