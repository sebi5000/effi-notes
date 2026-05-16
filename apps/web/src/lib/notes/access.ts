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

/** Prisma `where` fragment matching shares that have not expired. */
const activeShareWhere = (now: Date) => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

/**
 * Effective access for `userId` on a note: OWNER if author or an ancestor
 * folder owner, else the best active Share on the note or any ancestor
 * folder, else null. Returns null for a missing note.
 */
export const resolveNoteAccess = async (userId: string, noteId: string): Promise<Access | null> => {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { authorId: true, folderId: true },
  });
  if (!note) return null;
  if (note.authorId === userId) return 'OWNER';

  const chain = await folderChain(note.folderId);
  if (chain.some((f) => f.ownerId === userId)) return 'OWNER';

  const grants = await prisma.share.findMany({
    where: {
      granteeId: userId,
      AND: [
        activeShareWhere(new Date()),
        { OR: [{ noteId }, { folderId: { in: chain.map((f) => f.id) } }] },
      ],
    },
    select: { access: true },
  });
  return bestAccess(grants.map((g) => g.access));
};

/**
 * Effective access for `userId` on a folder: OWNER if the user owns the
 * folder or any ancestor, else the best active Share on the folder or any
 * ancestor, else null. Returns null for a missing folder.
 */
export const resolveFolderAccess = async (
  userId: string,
  folderId: string,
): Promise<Access | null> => {
  const chain = await folderChain(folderId);
  if (chain.length === 0) return null;
  if (chain.some((f) => f.ownerId === userId)) return 'OWNER';

  const grants = await prisma.share.findMany({
    where: {
      granteeId: userId,
      AND: [activeShareWhere(new Date()), { folderId: { in: chain.map((f) => f.id) } }],
    },
    select: { access: true },
  });
  return bestAccess(grants.map((g) => g.access));
};
