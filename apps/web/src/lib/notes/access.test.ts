import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupNotesDomain, makeTestFolder, makeTestUser } from '@/lib/api/test-session.ts';
import { atLeast, canEdit, canHardDelete, canManageShares, folderChain } from './access.ts';

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
