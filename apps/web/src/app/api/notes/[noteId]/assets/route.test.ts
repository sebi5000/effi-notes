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
import { POST } from './route.ts';

const mockedAuth = vi.mocked(auth);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const post = (noteId: string, body: BodyInit, filename = 'pic.png') =>
  POST(
    new Request(`http://localhost/api/notes/${noteId}/assets?filename=${filename}`, {
      method: 'POST',
      body,
    }),
    { params: Promise.resolve({ noteId }) },
  );

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('POST /api/notes/[noteId]/assets', () => {
  it('401 when unauthenticated', async () => {
    unauthed(mockedAuth);
    expect((await post('whatever', PNG)).status).toBe(401);
  });

  it('404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    expect((await post('missing-note', PNG)).status).toBe(404);
  });

  it('uploads an image and returns its id + url', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n', authorId: user.id } });
    const res = await post(note.id, PNG);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.url).toBe(`/api/assets/${body.id}`);
    const asset = await prisma.asset.findUnique({ where: { id: body.id } });
    expect(asset?.contentType).toBe('image/png');
    expect(asset?.noteId).toBe(note.id);
    expect(asset?.filename).toBe('pic.png');
    const audits = await prisma.auditLog.findMany({
      where: { action: 'assets.uploaded', subject: body.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(user.id);
  });

  it('415 for a non-image body (magic bytes mismatch)', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n2', authorId: user.id } });
    const res = await post(note.id, Buffer.from('%PDF-1.7'));
    expect(res.status).toBe(415);
  });

  it('413 for an over-sized body', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n3', authorId: user.id } });
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await post(note.id, big)).status).toBe(413);
  });

  it('400 when the filename query param is missing', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n4', authorId: user.id } });
    const res = await POST(
      new Request(`http://localhost/api/notes/${note.id}/assets`, { method: 'POST', body: PNG }),
      { params: Promise.resolve({ noteId: note.id }) },
    );
    expect(res.status).toBe(400);
  });
});
