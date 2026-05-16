import type { AppUser, Role } from '@app/auth/types';
import { prisma } from '@app/db';

/**
 * Test-only helper: create a real DB user and return an AppUser projection
 * matching the JWT-derived shape. Pair with a vi.mock('@/auth', ...) at the
 * top of the test file (hoisted) so route handlers see a controlled session.
 *
 * The mocked auth() returns either { user: AppUser } (authed) or null. The
 * type system can't model both without casts because NextAuth's `auth` is a
 * 4-way overload — the helpers below hide the cast in one place.
 */

type WithMockResolved = { mockResolvedValue(value: unknown): unknown };

export const authedAs = (mock: unknown, user: AppUser): void => {
  (mock as WithMockResolved).mockResolvedValue({ user });
};

export const unauthed = (mock: unknown): void => {
  (mock as WithMockResolved).mockResolvedValue(null);
};

export type TestUser = {
  user: AppUser;
};

const TEST_PREFIX = 'api-test-';

const randSuffix = (): string => crypto.randomUUID().slice(0, 8);

export const makeTestUser = async (
  opts: { roles?: ReadonlyArray<Role> } = {},
): Promise<TestUser> => {
  const roles: ReadonlyArray<Role> = opts.roles ?? ['user'];
  const sub = `${TEST_PREFIX}sub-${randSuffix()}`;
  const email = `${TEST_PREFIX}${randSuffix()}@example.invalid`;
  const created = await prisma.user.create({
    data: {
      keycloakSub: sub,
      email,
      displayName: 'Test User',
      roles: [...roles],
    },
    select: { id: true, keycloakSub: true, email: true, displayName: true, locale: true },
  });

  const user: AppUser = {
    id: created.id,
    keycloakSub: created.keycloakSub,
    email: created.email,
    displayName: created.displayName,
    locale: created.locale,
    roles,
  };

  return { user };
};

/**
 * Bulk cleanup for the notes domain. Matches the test prefix used by
 * makeTestUser plus tagged/folder rows created by tests. Cascade FKs handle
 * NoteTag/NoteHistory rows once their parents are gone.
 */
export const cleanupNotesDomain = async (): Promise<void> => {
  await prisma.share.deleteMany({
    where: {
      OR: [
        { grantee: { email: { startsWith: TEST_PREFIX } } },
        { createdBy: { email: { startsWith: TEST_PREFIX } } },
        { note: { author: { email: { startsWith: TEST_PREFIX } } } },
        { folder: { name: { startsWith: TEST_PREFIX } } },
      ],
    },
  });
  await prisma.noteHistory.deleteMany({
    where: { author: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.noteTag.deleteMany({
    where: { note: { author: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.note.deleteMany({
    where: { author: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.folder.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.tag.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
};

export const makeTestFolder = async (opts: {
  ownerId: string;
  parentId?: string;
  name?: string;
}): Promise<{ id: string }> =>
  prisma.folder.create({
    data: {
      name: opts.name ?? `${TEST_PREFIX}folder-${randSuffix()}`,
      ownerId: opts.ownerId,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
    },
    select: { id: true },
  });

export const makeTestNote = async (opts: {
  authorId: string;
  folderId?: string;
  title?: string;
  body?: string;
}): Promise<{ id: string }> =>
  prisma.note.create({
    data: {
      title: opts.title ?? `${TEST_PREFIX}note-${randSuffix()}`,
      body: opts.body ?? '',
      authorId: opts.authorId,
      ...(opts.folderId ? { folderId: opts.folderId } : {}),
    },
    select: { id: true },
  });

export const makeTestShare = async (opts: {
  noteId?: string;
  folderId?: string;
  granteeId: string;
  createdById: string;
  access: 'VIEW' | 'EDIT';
  expiresAt?: Date | null;
}): Promise<{ id: string }> =>
  prisma.share.create({
    data: {
      ...(opts.noteId ? { noteId: opts.noteId } : {}),
      ...(opts.folderId ? { folderId: opts.folderId } : {}),
      granteeId: opts.granteeId,
      createdById: opts.createdById,
      access: opts.access,
      expiresAt: opts.expiresAt ?? null,
    },
    select: { id: true },
  });
