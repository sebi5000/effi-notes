import { vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/auth';
import { cleanupNotesDomain, makeTestNote, makeTestUser } from '@/lib/api/test-session.ts';
import Page from './page.tsx';

const mockedAuth = vi.mocked(auth);

const propsOf = (element: unknown): { initialNotes: Array<{ id: string }> } => {
  // Page returns <Suspense><NotesShell .../></Suspense>
  // reason: traversing a React element tree the test constructed indirectly
  const suspense = element as { props: { children: { props: unknown } } };
  return suspense.props.children.props as { initialNotes: Array<{ id: string }> };
};

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /notes page', () => {
  it('excludes notes the user cannot access', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const foreign = await makeTestNote({ authorId: a.id, title: 'api-test-foreign' });
    const mine = await makeTestNote({ authorId: b.id, title: 'api-test-mine' });
    mockedAuth.mockResolvedValue({ user: b } as unknown as Awaited<ReturnType<typeof auth>>);
    const element = await Page();
    const ids = propsOf(element).initialNotes.map((n) => n.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(foreign.id);
  });
});
