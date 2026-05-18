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

describe('GET /api/notes', () => {
  it('returns 401 when there is no session', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/api/notes'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorised');
  });

  it('returns notes for an authenticated user', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.note.create({
      data: { title: 'api-test-list-target', body: '# hi', authorId: user.id },
    });
    const res = await GET(new Request('http://localhost/api/notes'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: Array<{ title: string }> };
    expect(body.notes.some((n) => n.title === 'api-test-list-target')).toBe(true);
  });

  it('filters by folderId', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const folder = await prisma.folder.create({
      data: { name: 'api-test-folder', ownerId: user.id },
    });
    await prisma.note.create({
      data: { title: 'api-test-in-folder', authorId: user.id, folderId: folder.id },
    });
    await prisma.note.create({
      data: { title: 'api-test-not-in-folder', authorId: user.id },
    });
    const res = await GET(new Request(`http://localhost/api/notes?folderId=${folder.id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: Array<{ title: string; folderId: string | null }> };
    expect(body.notes.map((n) => n.title)).toContain('api-test-in-folder');
    expect(body.notes.map((n) => n.title)).not.toContain('api-test-not-in-folder');
  });

  it('filters by tagId', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const tag = await prisma.tag.create({ data: { name: 'api-test-tag-filter' } });
    const note = await prisma.note.create({
      data: { title: 'api-test-tagged', authorId: user.id },
    });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });
    await prisma.note.create({ data: { title: 'api-test-untagged', authorId: user.id } });
    const res = await GET(new Request(`http://localhost/api/notes?tagId=${tag.id}`));
    const body = (await res.json()) as { notes: Array<{ title: string }> };
    expect(body.notes.map((n) => n.title)).toContain('api-test-tagged');
    expect(body.notes.map((n) => n.title)).not.toContain('api-test-untagged');
  });

  it('hides archived notes by default and reveals them with includeArchived=1', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.note.create({
      data: {
        title: 'api-test-archived',
        authorId: user.id,
        archivedAt: new Date(),
      },
    });
    const hidden = await GET(new Request('http://localhost/api/notes'));
    const hiddenBody = (await hidden.json()) as { notes: Array<{ title: string }> };
    expect(hiddenBody.notes.map((n) => n.title)).not.toContain('api-test-archived');

    const revealed = await GET(new Request('http://localhost/api/notes?includeArchived=1'));
    const revealedBody = (await revealed.json()) as { notes: Array<{ title: string }> };
    expect(revealedBody.notes.map((n) => n.title)).toContain('api-test-archived');
  });

  it('returns 400 when the query is malformed', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/api/notes?limit=not-a-number'));
    expect(res.status).toBe(400);
  });

  it('tags a directly-shared note with sharedWithMe', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await prisma.note.create({
      data: { title: 'api-test-shared-note', body: '', authorId: owner.id },
    });
    await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(grantee);
    const res = await GET(new Request('http://localhost/api/notes'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notes: Array<{ id: string; sharedWithMe?: { access: string } }>;
    };
    expect(body.notes.find((n) => n.id === note.id)?.sharedWithMe?.access).toBe('VIEW');
  });

  it('does not tag a note that is only inside a shared folder', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await prisma.folder.create({
      data: { name: 'api-test-shared-folder-container', ownerId: owner.id },
    });
    const note = await prisma.note.create({
      data: {
        title: 'api-test-note-inside-shared-folder',
        body: '',
        authorId: owner.id,
        folderId: folder.id,
      },
    });
    await makeTestShare({
      folderId: folder.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(grantee);
    const res = await GET(new Request('http://localhost/api/notes'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notes: Array<{ id: string; sharedWithMe?: { access: string } }>;
    };
    const found = body.notes.find((n) => n.id === note.id);
    expect(found).toBeDefined();
    expect(found?.sharedWithMe).toBeUndefined();
  });

  it('returns a snippet derived from the body, not the full body', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    await prisma.note.create({
      data: {
        title: 'api-test-snippet',
        body: 'First line of the note.\n\nSecond paragraph here.',
        authorId: user.id,
      },
    });
    const res = await GET(new Request('http://localhost/api/notes'));
    const body = (await res.json()) as { notes: Array<Record<string, unknown>> };
    const item = body.notes.find((n) => n.title === 'api-test-snippet');
    expect(item).toBeDefined();
    expect(item?.snippet).toBe('First line of the note. Second paragraph here.');
    expect(item).not.toHaveProperty('body');
  });
});

describe('POST /api/notes', () => {
  it('returns 401 when there is no session', async () => {
    setUnauthed();
    const res = await POST(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'api-test-x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('creates a note and returns 201 with the created body', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const folder = await prisma.folder.create({
      data: { name: 'api-test-target-folder', ownerId: user.id },
    });
    const tag = await prisma.tag.create({ data: { name: 'api-test-tag-on-create' } });
    const res = await POST(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'api-test-create',
          folderId: folder.id,
          tagIds: [tag.id],
          body: '# Hello',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; title: string; tags: Array<{ id: string }> };
    expect(body.title).toBe('api-test-create');
    expect(body.tags.map((t) => t.id)).toContain(tag.id);

    const inDb = await prisma.note.findUnique({ where: { id: body.id } });
    expect(inDb?.authorId).toBe(user.id);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'notes.created', subject: body.id },
    });
    expect(audits.length).toBe(1);
  });

  it('returns 400 on malformed body (Zod)', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET/POST /api/notes — authorization', () => {
  it("list excludes another user's private notes", async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    await makeTestNote({ authorId: a.id, title: 'api-test-private-a' });
    const mine = await makeTestNote({ authorId: b.id, title: 'api-test-mine-b' });
    setAuthed(b);
    const res = await GET(new Request('http://localhost/api/notes'));
    const body = (await res.json()) as { notes: Array<{ id: string }> };
    const ids = body.notes.map((n) => n.id);
    expect(ids).toContain(mine.id);
    const privateA = await prisma.note.findFirst({ where: { title: 'api-test-private-a' } });
    expect(ids).not.toContain(privateA?.id);
  });

  it('403s POST into a folder the user cannot edit', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await prisma.folder.create({
      data: { name: 'api-test-foreign-folder', ownerId: a.id },
    });
    setAuthed(b);
    const res = await POST(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x', folderId: folder.id }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
