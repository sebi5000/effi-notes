import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupNotesDomain,
  makeTestFolder,
  makeTestNote,
  makeTestShare,
  makeTestUser,
} from '@/lib/api/test-session.ts';
import {
  atLeast,
  canEdit,
  canHardDelete,
  canManageShares,
  folderChain,
  listAccessibleScope,
  resolveFolderAccess,
  resolveNoteAccess,
} from './access.ts';

describe('access rank helpers', () => {
  it('atLeast compares the rank ladder', () => {
    expect(atLeast('OWNER', 'VIEW')).toBe(true);
    expect(atLeast('EDIT', 'EDIT')).toBe(true);
    expect(atLeast('VIEW', 'EDIT')).toBe(false);
    expect(atLeast(null, 'VIEW')).toBe(false);
  });

  it('canEdit / canManageShares need EDIT or higher', () => {
    expect(canEdit('EDIT')).toBe(true);
    expect(canEdit('VIEW')).toBe(false);
    expect(canManageShares('OWNER')).toBe(true);
    expect(canManageShares('VIEW')).toBe(false);
    expect(canManageShares(null)).toBe(false);
  });

  it('canHardDelete needs OWNER', () => {
    expect(canHardDelete('OWNER')).toBe(true);
    expect(canHardDelete('EDIT')).toBe(false);
  });
});

describe('folderChain', () => {
  beforeEach(async () => {
    await cleanupNotesDomain();
  });
  afterAll(async () => {
    await cleanupNotesDomain();
    await prisma.$disconnect();
  });

  it('returns the folder and all ancestors, nearest-first', async () => {
    const { user } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: user.id });
    const mid = await makeTestFolder({ ownerId: user.id, parentId: root.id });
    const leaf = await makeTestFolder({ ownerId: user.id, parentId: mid.id });

    const chain = await folderChain(leaf.id);
    expect(chain.map((f) => f.id)).toEqual([leaf.id, mid.id, root.id]);
  });

  it('returns [] for a null folderId and for a missing id', async () => {
    expect(await folderChain(null)).toEqual([]);
    expect(await folderChain('does-not-exist')).toEqual([]);
  });
});

describe('resolveNoteAccess', () => {
  it('returns null for a missing note', async () => {
    const { user } = await makeTestUser();
    expect(await resolveNoteAccess(user.id, 'missing')).toBeNull();
  });

  it('OWNER for the author', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    expect(await resolveNoteAccess(user.id, note.id)).toBe('OWNER');
  });

  it('null for an unrelated user', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    expect(await resolveNoteAccess(b.id, note.id)).toBeNull();
  });

  it('reflects a direct note share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    await makeTestShare({ noteId: note.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    expect(await resolveNoteAccess(b.id, note.id)).toBe('VIEW');
  });

  it('inherits an ancestor folder share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: a.id, parentId: root.id });
    const note = await makeTestNote({ authorId: a.id, folderId: sub.id });
    await makeTestShare({ folderId: root.id, granteeId: b.id, createdById: a.id, access: 'EDIT' });
    expect(await resolveNoteAccess(b.id, note.id)).toBe('EDIT');
  });

  it('OWNER when the user owns an ancestor folder', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: a.id });
    const note = await makeTestNote({ authorId: b.id, folderId: folder.id });
    expect(await resolveNoteAccess(a.id, note.id)).toBe('OWNER');
  });

  it('ignores an expired share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    await makeTestShare({
      noteId: note.id,
      granteeId: b.id,
      createdById: a.id,
      access: 'EDIT',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await resolveNoteAccess(b.id, note.id)).toBeNull();
  });
});

describe('resolveFolderAccess', () => {
  it('returns null for a missing folder', async () => {
    const { user } = await makeTestUser();
    expect(await resolveFolderAccess(user.id, 'missing')).toBeNull();
  });

  it('OWNER for the folder owner', async () => {
    const { user } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: user.id });
    expect(await resolveFolderAccess(user.id, folder.id)).toBe('OWNER');
  });

  it('OWNER when the user owns an ancestor folder', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: b.id, parentId: root.id });
    expect(await resolveFolderAccess(a.id, sub.id)).toBe('OWNER');
  });

  it('reflects a direct or inherited folder share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: a.id, parentId: root.id });
    await makeTestShare({ folderId: root.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    expect(await resolveFolderAccess(b.id, sub.id)).toBe('VIEW');
  });

  it('null for an unrelated user', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: a.id });
    expect(await resolveFolderAccess(b.id, folder.id)).toBeNull();
  });
});

describe('listAccessibleScope', () => {
  it('includes owned folders and their descendants', async () => {
    const { user } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: user.id });
    const sub = await makeTestFolder({ ownerId: user.id, parentId: root.id });
    const scope = await listAccessibleScope(user.id);
    expect(scope.accessibleFolderIds).toEqual(expect.arrayContaining([root.id, sub.id]));
  });

  it('includes shared folders, their descendants, and shared notes', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: a.id, parentId: root.id });
    const note = await makeTestNote({ authorId: a.id });
    await makeTestShare({ folderId: root.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    await makeTestShare({ noteId: note.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    const scope = await listAccessibleScope(b.id);
    expect(scope.accessibleFolderIds).toEqual(expect.arrayContaining([root.id, sub.id]));
    expect(scope.sharedNoteIds).toContain(note.id);
  });

  it('excludes a folder shared only via an expired grant', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: a.id });
    await makeTestShare({
      folderId: folder.id,
      granteeId: b.id,
      createdById: a.id,
      access: 'VIEW',
      expiresAt: new Date(Date.now() - 1000),
    });
    const scope = await listAccessibleScope(b.id);
    expect(scope.accessibleFolderIds).not.toContain(folder.id);
  });
});
