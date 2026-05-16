import { prisma } from '@app/db';

/**
 * Permission-resolution engine — the single source of authorization truth
 * for notes and folders. See docs/adr/0026-explicit-resource-sharing.md.
 */

export type Access = 'OWNER' | 'EDIT' | 'VIEW';

const RANK: Record<Access, number> = { VIEW: 1, EDIT: 2, OWNER: 3 };

/** True when `access` is at least `min` on the OWNER > EDIT > VIEW ladder. */
export const atLeast = (access: Access | null, min: Access): boolean =>
  access !== null && RANK[access] >= RANK[min];

export const canEdit = (access: Access | null): boolean => atLeast(access, 'EDIT');
export const canManageShares = (access: Access | null): boolean => atLeast(access, 'EDIT');
export const canHardDelete = (access: Access | null): boolean => atLeast(access, 'OWNER');

const bestAccess = (accesses: ReadonlyArray<Access>): Access | null => {
  if (accesses.length === 0) return null;
  return accesses.reduce((best, a) => (RANK[a] > RANK[best] ? a : best));
};

const MAX_FOLDER_DEPTH = 64;

export type FolderLink = { id: string; ownerId: string };

/**
 * The folder and every ancestor, nearest-first. Cycle-safe (a `visited`
 * set + depth cap) so a corrupt parent chain cannot loop forever. Returns
 * `[]` for a null id or a missing folder.
 */
export const folderChain = async (folderId: string | null): Promise<FolderLink[]> => {
  const chain: FolderLink[] = [];
  const visited = new Set<string>();
  let current = folderId;
  while (current !== null && !visited.has(current) && chain.length < MAX_FOLDER_DEPTH) {
    visited.add(current);
    const folder = await prisma.folder.findUnique({
      where: { id: current },
      select: { id: true, ownerId: true, parentId: true },
    });
    if (!folder) break;
    chain.push({ id: folder.id, ownerId: folder.ownerId });
    current = folder.parentId;
  }
  return chain;
};
