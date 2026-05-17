import { vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/auth';
import { cleanupNotesDomain, makeTestNote, makeTestUser } from '@/lib/api/test-session.ts';
import Page from './page.tsx';

const mockedAuth = vi.mocked(auth);

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /notes/[noteId] page', () => {
  it('notFound()s a note the user cannot access', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const foreign = await makeTestNote({ authorId: a.id });
    mockedAuth.mockResolvedValue({ user: b } as unknown as Awaited<ReturnType<typeof auth>>);
    await expect(Page({ params: Promise.resolve({ noteId: foreign.id }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('renders a note the user owns', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    mockedAuth.mockResolvedValue({ user } as unknown as Awaited<ReturnType<typeof auth>>);
    const element = await Page({ params: Promise.resolve({ noteId: note.id }) });
    expect(element).toBeTruthy();
  });
});
