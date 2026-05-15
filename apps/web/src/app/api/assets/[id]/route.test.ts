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
import { GET, PATCH } from './route.ts';

const mockedAuth = vi.mocked(auth);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const seedAsset = async (authorId: string) => {
  const note = await prisma.note.create({ data: { title: 'api-test-an', authorId } });
  return prisma.asset.create({
    data: {
      noteId: note.id,
      authorId,
      kind: 'IMAGE',
      contentType: 'image/png',
      filename: 'api-test.png',
      byteSize: PNG.byteLength,
      data: PNG,
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

describe('GET /api/assets/[id]', () => {
  it('401 when unauthenticated', async () => {
    unauthed(mockedAuth);
    const res = await GET(new Request('http://localhost/api/assets/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('404 for an unknown id', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const res = await GET(new Request('http://localhost/api/assets/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('serves the bytes with the stored content type', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedAsset(user.id);
    const res = await GET(new Request(`http://localhost/api/assets/${asset.id}`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });
});

describe('PATCH /api/assets/[id]', () => {
  it('updates the caption', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedAsset(user.id);
    const res = await PATCH(
      new Request(`http://localhost/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: 'A nice photo' }),
      }),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(res.status).toBe(200);
    const reloaded = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(reloaded?.caption).toBe('A nice photo');
  });

  it('400 on an invalid body', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedAsset(user.id);
    const res = await PATCH(
      new Request(`http://localhost/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: 123 }),
      }),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('400 on a malformed JSON body', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedAsset(user.id);
    const res = await PATCH(
      new Request(`http://localhost/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not json{',
      }),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('404 patching an unknown id', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const res = await PATCH(
      new Request('http://localhost/api/assets/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: 'x' }),
      }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });
});
