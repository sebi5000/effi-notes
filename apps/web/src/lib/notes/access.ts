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

/** Metadata about a single direct Share to the current user. */
export type DirectShare = {
  shareId: string;
  /** The sharer's display name, or their email when no display name is set. */
  sharedByName: string;
  access: 'VIEW' | 'EDIT';
  /** When the grantee first opened the resource, or null if not yet. */
  seenAt: Date | null;
};

export type AccessibleScope = {
  /** Folder ids the user owns or has a share on, plus all descendants. */
  accessibleFolderIds: string[];
  /** Note ids shared directly with the user. */
  sharedNoteIds: string[];
  /** Direct shares to the user, keyed by the shared folder/note id. */
  directShares: Map<string, DirectShare>;
};

/**
 * The set of folders/notes a user may see, for filtering list & search.
 * Loads the (small) folder table once and expands the tree in memory.
 */
export const listAccessibleScope = async (userId: string): Promise<AccessibleScope> => {
  const now = new Date();
  const [folders, folderShares, noteShares] = await Promise.all([
    prisma.folder.findMany({ select: { id: true, parentId: true, ownerId: true } }),
    prisma.share.findMany({
      where: { granteeId: userId, folderId: { not: null }, AND: [activeShareWhere(now)] },
      select: {
        id: true,
        folderId: true,
        access: true,
        seenAt: true,
        createdBy: { select: { displayName: true, email: true } },
      },
    }),
    prisma.share.findMany({
      where: { granteeId: userId, noteId: { not: null }, AND: [activeShareWhere(now)] },
      select: {
        id: true,
        noteId: true,
        access: true,
        seenAt: true,
        createdBy: { select: { displayName: true, email: true } },
      },
    }),
  ]);

  const childrenOf = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === null) continue;
    const arr = childrenOf.get(f.parentId) ?? [];
    arr.push(f.id);
    childrenOf.set(f.parentId, arr);
  }

  const roots = new Set<string>();
  for (const f of folders) if (f.ownerId === userId) roots.add(f.id);
  for (const s of folderShares) if (s.folderId !== null) roots.add(s.folderId);

  const accessible = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (accessible.has(id)) continue;
    accessible.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }

  const directShares = new Map<string, DirectShare>();
  for (const s of folderShares) {
    // Narrows `folderId` to string — the query's `where` already excludes nulls.
    if (s.folderId === null) continue;
    directShares.set(s.folderId, {
      shareId: s.id,
      sharedByName: s.createdBy.displayName ?? s.createdBy.email,
      access: s.access,
      seenAt: s.seenAt,
    });
  }
  for (const s of noteShares) {
    // Narrows `noteId` to string — the query's `where` already excludes nulls.
    if (s.noteId === null) continue;
    directShares.set(s.noteId, {
      shareId: s.id,
      sharedByName: s.createdBy.displayName ?? s.createdBy.email,
      access: s.access,
      seenAt: s.seenAt,
    });
  }

  return {
    accessibleFolderIds: [...accessible],
    sharedNoteIds: noteShares.map((s) => s.noteId).filter((id): id is string => id !== null),
    directShares,
  };
};
