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
import { GET } from './route.ts';

const mockedAuth = vi.mocked(auth);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const seedPdfAsset = async (authorId: string, withPreview: boolean) => {
  const note = await prisma.note.create({ data: { title: 'prev-note', authorId } });
  return prisma.asset.create({
    data: {
      noteId: note.id,
      authorId,
      kind: 'PDF',
      contentType: 'application/pdf',
      filename: 'doc.pdf',
      byteSize: 64,
      data: Buffer.from('%PDF-1.4'),
      ...(withPreview ? { previewImage: PNG, previewContentType: 'image/png' } : {}),
    },
  });
};

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/assets/[id]/preview', () => {
  it('401 when unauthenticated', async () => {
    unauthed(mockedAuth);
    const res = await GET(new Request('http://localhost/api/assets/x/preview'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('404 for an unknown id', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const res = await GET(new Request('http://localhost/api/assets/missing/preview'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('404 when the preview has not been rendered yet', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedPdfAsset(user.id, false);
    const res = await GET(new Request(`http://localhost/api/assets/${asset.id}/preview`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(res.status).toBe(404);
  });

  it('serves the preview PNG once rendered', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedPdfAsset(user.id, true);
    const res = await GET(new Request(`http://localhost/api/assets/${asset.id}/preview`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });
});
