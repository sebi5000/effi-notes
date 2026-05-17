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

describe('POST /api/notes/[id]/duplicate', () => {
  it('returns 401 when there is no session', async () => {
    setUnauthed();
    const res = await POST(new Request('http://localhost/api/notes/x/duplicate'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(new Request('http://localhost/api/notes/missing/duplicate'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 when an unrelated user has no access', async () => {
    const { user: owner } = await makeTestUser();
    const { user: stranger } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id, title: 'api-test-dup-403' });
    setAuthed(stranger);
    const res = await POST(new Request(`http://localhost/api/notes/${note.id}/duplicate`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(403);
  });

  it('owner duplicates a note: status 201, different id, correct authorId, title, titleManuallySet, folderId', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const folder = await prisma.folder.create({
      data: { name: 'api-test-dup-folder', ownerId: user.id },
    });
    const note = await prisma.note.create({
      data: {
        title: 'api-test-orig',
        body: '# Hello',
        authorId: user.id,
        folderId: folder.id,
      },
    });

    const res = await POST(new Request(`http://localhost/api/notes/${note.id}/duplicate`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      title: string;
      authorId: string;
      folderId: string | null;
    };
    expect(body.id).not.toBe(note.id);
    expect(body.authorId).toBe(user.id);
    expect(body.title).toBe('api-test-orig (Kopie)');
    expect(body.folderId).toBe(folder.id);

    // Reload to verify titleManuallySet persisted
    const reloaded = await prisma.note.findUnique({ where: { id: body.id } });
    expect(reloaded?.titleManuallySet).toBe(true);
  });

  it('tags are copied: the duplicate has the same tag', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const tag = await prisma.tag.create({ data: { name: 'api-test-dup-tag' } });
    const note = await prisma.note.create({
      data: {
        title: 'api-test-tag-dup',
        body: '',
        authorId: user.id,
        tags: { create: { tagId: tag.id } },
      },
    });

    const res = await POST(new Request(`http://localhost/api/notes/${note.id}/duplicate`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string; tags: Array<{ id: string }> };
    const noteTags = await prisma.noteTag.findMany({ where: { noteId: body.id } });
    expect(noteTags.map((t) => t.tagId)).toContain(tag.id);
  });

  it('copies the Yjs document state', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const state = Buffer.from([1, 2, 3, 4]);
    const note = await prisma.note.create({
      data: { title: 'api-test-dup-yjs', authorId: user.id, yjsState: state },
    });
    const res = await POST(new Request('http://localhost/x', { method: 'POST' }), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const copy = await prisma.note.findUnique({ where: { id: body.id } });
    expect(copy?.yjsState).not.toBeNull();
    expect(Buffer.from(copy?.yjsState ?? []).equals(state)).toBe(true);
  });

  it('writes an AuditLog row with action notes.duplicated for the new note', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await makeTestNote({ authorId: user.id, title: 'api-test-dup-audit' });

    const res = await POST(new Request(`http://localhost/api/notes/${note.id}/duplicate`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string };
    const audits = await prisma.auditLog.findMany({
      where: { action: 'notes.duplicated', subject: body.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(user.id);
  });
});
