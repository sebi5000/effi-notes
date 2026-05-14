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
import { DELETE } from './route.ts';

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

describe('DELETE /api/tags/[id]', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await DELETE(new Request('http://localhost/api/tags/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when tag does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await DELETE(new Request('http://localhost/api/tags/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('deletes the tag and cascades the note links', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const tag = await prisma.tag.create({ data: { name: 'api-test-deletetag' } });
    const note = await prisma.note.create({
      data: {
        title: 'api-test-tagged-for-delete',
        authorId: user.id,
        tags: { create: { tagId: tag.id } },
      },
    });

    const res = await DELETE(new Request(`http://localhost/api/tags/${tag.id}`), {
      params: Promise.resolve({ id: tag.id }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.tag.count({ where: { id: tag.id } })).toBe(0);
    expect(await prisma.noteTag.count({ where: { tagId: tag.id } })).toBe(0);
    expect(await prisma.note.count({ where: { id: note.id } })).toBe(1);
  });
});
