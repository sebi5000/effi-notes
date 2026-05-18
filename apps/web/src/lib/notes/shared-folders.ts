import type { FolderNode } from '@/lib/api/schemas.ts';

/**
 * Split a folder list into the user's own folders and the folders reached
 * via a share. A folder belongs to `shared` when it carries `sharedWithMe`
 * (a directly-shared root) or descends from one; everything else is `own`.
 * The ancestor walk is cycle-safe.
 */
export const partitionSharedFolders = (
  folders: ReadonlyArray<FolderNode>,
): { own: FolderNode[]; shared: FolderNode[] } => {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const sharedRootIds = new Set(
    folders.filter((f) => f.sharedWithMe !== undefined).map((f) => f.id),
  );

  const isShared = (start: FolderNode): boolean => {
    let current: FolderNode | undefined = start;
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current.id)) {
      if (sharedRootIds.has(current.id)) return true;
      visited.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return false;
  };

  const own: FolderNode[] = [];
  const shared: FolderNode[] = [];
  for (const f of folders) {
    if (isShared(f)) shared.push(f);
    else own.push(f);
  }
  return { own, shared };
};
