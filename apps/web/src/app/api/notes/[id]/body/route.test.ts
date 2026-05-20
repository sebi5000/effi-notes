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
import { PUT } from './route.ts';

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

const callPut = (id: string, body: unknown) =>
  PUT(
    new Request(`http://localhost/api/notes/${id}/body`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('PUT /api/notes/[id]/body', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthed();
    const res = await callPut('x', { body: 'new', baseBodyVersion: 0 });
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid JSON', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await callPut('x', '{nope');
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid body shape', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await callPut('x', { body: 'new' }); // missing baseBodyVersion
    expect(res.status).toBe(400);
  });

  it('returns 404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await callPut('missing', {
      body: 'new',
      baseBodyVersion: 0,
    });
    expect(res.status).toBe(404);
  });

  it('saves the body, increments bodyVersion, and returns it', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-body', body: 'old', authorId: user.id },
    });
    expect(note.bodyVersion).toBe(0);
    const res = await callPut(note.id, {
      body: '# new body',
      baseBodyVersion: 0,
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { bodyVersion: number };
    expect(payload.bodyVersion).toBe(1);
    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.body).toBe('# new body');
    expect(reloaded?.lastEditorId).toBe(user.id);
    expect(reloaded?.bodyVersion).toBe(1);
  });

  it('returns 409 when baseBodyVersion is stale', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-conflict', body: 'middle', authorId: user.id, bodyVersion: 3 },
    });
    // Client thinks it's at version 2, but the server has version 3.
    const res = await callPut(note.id, {
      body: '# attempt',
      baseBodyVersion: 2,
    });
    expect(res.status).toBe(409);
    const payload = (await res.json()) as {
      error: string;
      details: { currentBodyVersion: number };
    };
    expect(payload.error).toBe('conflict');
    expect(payload.details.currentBodyVersion).toBe(3);
    // Body must NOT have been overwritten.
    const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
    expect(reloaded?.body).toBe('middle');
    expect(reloaded?.bodyVersion).toBe(3);
  });

  it('title-only PATCH does NOT bump bodyVersion (would have produced false 409s)', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({
      data: { title: 'api-test-title-doesnt-bump', body: 'b', authorId: user.id },
    });
    // Simulate a title-only patch happening between two body saves.
    await prisma.note.update({ where: { id: note.id }, data: { title: 'renamed' } });
    const res = await callPut(note.id, { body: 'b2', baseBodyVersion: 0 });
    expect(res.status).toBe(200);
  });

  it('marks an asset the save no longer references', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({ data: { title: 'recon-1', authorId: user.id } });
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'a.png',
        byteSize: 8,
        data: Buffer.from('%PNG'),
      },
    });
    const res = await callPut(note.id, {
      body: 'text',
      baseBodyVersion: 0,
      assetIds: [],
    });
    expect(res.status).toBe(200);
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince).not.toBeNull();
  });

  it('un-marks an asset the save references again', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({ data: { title: 'recon-2', authorId: user.id } });
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'b.png',
        byteSize: 8,
        data: Buffer.from('%PNG'),
        unreferencedSince: new Date('2026-05-01T00:00:00.000Z'),
      },
    });
    const res = await callPut(note.id, {
      body: 't',
      baseBodyVersion: 0,
      assetIds: [asset.id],
    });
    expect(res.status).toBe(200);
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince).toBeNull();
  });

  it('keeps the original timestamp of an already-marked asset', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({ data: { title: 'recon-3', authorId: user.id } });
    const stamp = new Date('2026-05-02T00:00:00.000Z');
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'c.png',
        byteSize: 8,
        data: Buffer.from('%PNG'),
        unreferencedSince: stamp,
      },
    });
    await callPut(note.id, {
      body: 't',
      baseBodyVersion: 0,
      assetIds: [],
    });
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince?.getTime()).toBe(stamp.getTime());
  });

  it('does not reconcile when assetIds is omitted', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await prisma.note.create({ data: { title: 'recon-4', authorId: user.id } });
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'd.png',
        byteSize: 8,
        data: Buffer.from('%PNG'),
      },
    });
    await callPut(note.id, {
      body: 't',
      baseBodyVersion: 0,
    });
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince).toBeNull();
  });

  it('403s PUT body for a non-editor', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    setAuthed(b);
    const res = await PUT(
      new Request(`http://localhost/api/notes/${note.id}/body`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'x', baseBodyVersion: 0 }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    expect(res.status).toBe(403);
  });
});
