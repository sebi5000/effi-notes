import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupNotesDomain, makeTestNote, makeTestUser } from '@/lib/api/test-session.ts';
import { generatePublicToken } from '@/lib/notes/public-link-token.ts';
import { GET } from './route.ts';

const ctx = (token: string, assetId: string) => ({ params: Promise.resolve({ token, assetId }) });
const req = () => new Request('http://localhost/p/x/assets/y');

const makeAsset = (noteId: string, authorId: string): Promise<{ id: string }> =>
  prisma.asset.create({
    data: {
      noteId,
      authorId,
      kind: 'IMAGE',
      contentType: 'image/png',
      filename: 'api-test.png',
      byteSize: 3,
      data: Buffer.from([1, 2, 3]),
    },
    select: { id: true },
  });

beforeEach(async () => {
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /p/[token]/assets/[assetId]', () => {
  it('serves an asset of the publicly-linked note', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    const asset = await makeAsset(note.id, user.id);
    const token = generatePublicToken();
    await prisma.publicLink.create({ data: { token, noteId: note.id, createdById: user.id } });

    const res = await GET(req(), ctx(token, asset.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('404 for an unknown token', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    const asset = await makeAsset(note.id, user.id);
    const res = await GET(req(), ctx(generatePublicToken(), asset.id));
    expect(res.status).toBe(404);
  });

  it('404 for an asset that belongs to a different note', async () => {
    const { user } = await makeTestUser();
    const linked = await makeTestNote({ authorId: user.id });
    const other = await makeTestNote({ authorId: user.id });
    const otherAsset = await makeAsset(other.id, user.id);
    const token = generatePublicToken();
    await prisma.publicLink.create({ data: { token, noteId: linked.id, createdById: user.id } });

    const res = await GET(req(), ctx(token, otherAsset.id));
    expect(res.status).toBe(404);
  });

  it('404 when the public link has expired', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    const asset = await makeAsset(note.id, user.id);
    const token = generatePublicToken();
    await prisma.publicLink.create({
      data: {
        token,
        noteId: note.id,
        createdById: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const res = await GET(req(), ctx(token, asset.id));
    expect(res.status).toBe(404);
  });
});
