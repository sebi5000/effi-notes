import type { FolderNode } from '@/lib/api/schemas.ts';

/**
 * Pure logic for the sidebar's folder tree.
 *
 * The API returns a flat list of FolderNode rows. The UI wants:
 *   - a recursive tree keyed by parentId,
 *   - a flattened-with-depth list for accessible ARIA tree rendering, and
 *   - keyboard-navigation helpers (next / prev visible folder).
 *
 * Everything in this file is a pure function so it tests without React.
 */

export type FolderTreeNode = FolderNode & {
  children: FolderTreeNode[];
};

export type FlatFolder = FolderNode & {
  depth: number;
  hasChildren: boolean;
};

export const buildFolderTree = (folders: ReadonlyArray<FolderNode>): FolderTreeNode[] => {
  const byId = new Map<string, FolderTreeNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: FolderTreeNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.id);
    if (!node) continue;
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortByPosition = (nodes: FolderTreeNode[]): void => {
    nodes.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    for (const n of nodes) sortByPosition(n.children);
  };
  sortByPosition(roots);
  return roots;
};

export const flatten = (
  tree: ReadonlyArray<FolderTreeNode>,
  expanded: ReadonlySet<string>,
  depth = 0,
): FlatFolder[] => {
  const out: FlatFolder[] = [];
  for (const node of tree) {
    out.push({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      position: node.position,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      shareCount: node.shareCount,
      depth,
      hasChildren: node.children.length > 0,
    });
    if (expanded.has(node.id) && node.children.length > 0) {
      out.push(...flatten(node.children, expanded, depth + 1));
    }
  }
  return out;
};

export const moveSelection = (
  visible: ReadonlyArray<FlatFolder>,
  current: string | null,
  direction: 'up' | 'down',
): string | null => {
  if (visible.length === 0) return null;
  if (current === null) return visible[0]?.id ?? null;
  const idx = visible.findIndex((f) => f.id === current);
  if (idx === -1) return visible[0]?.id ?? null;
  const next = direction === 'down' ? idx + 1 : idx - 1;
  if (next < 0 || next >= visible.length) return current;
  return visible[next]?.id ?? current;
};

/**
 * True iff `candidateId` is a (strict or non-strict) descendant of
 * `ancestorId`. Used as the drop-target guard so a user can't drag a
 * folder into its own subtree (which would create a cycle and orphan
 * the entire branch on the server).
 */
export const isDescendant = (
  folders: ReadonlyArray<FolderNode>,
  ancestorId: string,
  candidateId: string,
): boolean => {
  if (ancestorId === candidateId) return true;
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, f);
  let cursor: string | null | undefined = byId.get(candidateId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
};

/** Returns the ancestor chain (root → child → … → target). */
export const ancestorChain = (folders: ReadonlyArray<FolderNode>, targetId: string): string[] => {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, f);
  const chain: string[] = [];
  let cursor: string | null = targetId;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    chain.unshift(node.id);
    cursor = node.parentId;
  }
  return chain;
};

/**
 * Direct children of `parentId` (`null` = root level), ordered the way the
 * tree renders them: by `position`, then name as a stable tiebreak.
 */
export const childrenOf = (
  folders: ReadonlyArray<FolderNode>,
  parentId: string | null,
): FolderNode[] =>
  folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .slice()
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

/** Where a drop lands relative to the target row. */
export type DropMode = 'before' | 'inside' | 'after';

export type ReorderPlan = {
  /** New parent for the whole `orderedIds` group (`null` = root). */
  parentId: string | null;
  /** Final, fully-ordered sibling list for `parentId`, including the dragged folder. */
  orderedIds: string[];
};

/**
 * Pure drop resolver for folder drag-and-drop.
 *
 * Given the flat folder list, the dragged folder, a target row and a drop
 * mode, returns the new parent + the complete ordered sibling list for that
 * parent (the dragged folder spliced into place). Returns `null` for an
 * illegal drop:
 *   - dragging onto itself,
 *   - `inside` a folder that is the dragged folder's own descendant
 *     (would create a cycle),
 *   - `before`/`after` a row whose parent is the dragged folder's descendant.
 *
 * The caller persists the plan via the reorder endpoint, which sets
 * `parentId` + contiguous `position` for every id in `orderedIds`.
 */
export const computeReorder = (
  folders: ReadonlyArray<FolderNode>,
  draggedId: string,
  targetId: string,
  mode: DropMode,
): ReorderPlan | null => {
  if (draggedId === targetId) return null;
  const dragged = folders.find((f) => f.id === draggedId);
  const target = folders.find((f) => f.id === targetId);
  if (!dragged || !target) return null;

  if (mode === 'inside') {
    // Nesting into the dragged folder's own subtree would orphan the branch.
    if (isDescendant(folders, draggedId, targetId)) return null;
    const kids = childrenOf(folders, targetId).filter((f) => f.id !== draggedId);
    return { parentId: targetId, orderedIds: [...kids.map((k) => k.id), draggedId] };
  }

  // before / after — the dragged folder becomes a sibling of `target`.
  const parentId = target.parentId ?? null;
  if (parentId !== null && isDescendant(folders, draggedId, parentId)) return null;
  const siblings = childrenOf(folders, parentId).filter((f) => f.id !== draggedId);
  const targetIdx = siblings.findIndex((s) => s.id === targetId);
  if (targetIdx === -1) return null;
  const insertAt = mode === 'before' ? targetIdx : targetIdx + 1;
  const orderedIds = siblings.map((s) => s.id);
  orderedIds.splice(insertAt, 0, draggedId);
  return { parentId, orderedIds };
};

/** Reorder plan for dropping a folder onto the root drop-zone. */
export const computeRootReorder = (
  folders: ReadonlyArray<FolderNode>,
  draggedId: string,
): ReorderPlan | null => {
  if (!folders.some((f) => f.id === draggedId)) return null;
  const roots = childrenOf(folders, null)
    .filter((f) => f.id !== draggedId)
    .map((f) => f.id);
  return { parentId: null, orderedIds: [...roots, draggedId] };
};

/**
 * True iff `plan` would leave every folder exactly where it already is
 * (same parent, same order). Lets the caller skip a redundant network
 * round-trip when a drag ends without really moving anything.
 */
export const isNoopReorder = (folders: ReadonlyArray<FolderNode>, plan: ReorderPlan): boolean => {
  const current = childrenOf(folders, plan.parentId).map((f) => f.id);
  if (current.length !== plan.orderedIds.length) return false;
  return current.every((id, i) => id === plan.orderedIds[i]);
};

/**
 * The `/`-joined name path from root to `folderId`, e.g.
 * `Clients/Intech/Support`. Returns an empty string if `folderId` (or any
 * ancestor) is unknown.
 *
 * Note: a folder whose own name contains `/` is not round-trippable through
 * a path — an accepted limitation of the path syntax.
 */
export const folderPath = (folders: ReadonlyArray<FolderNode>, folderId: string): string => {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, f);
  const names: string[] = [];
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) return '';
    names.unshift(node.name);
    cursor = node.parentId;
  }
  return names.join('/');
};

/**
 * Resolve a `/`-style path (`Clients/Intech/Support`) to a folder id by
 * walking the tree from the root, matching each segment's name
 * case-insensitively. Returns `null` if any segment has no match. Segments
 * are trimmed; empty segments (e.g. a trailing slash) are dropped.
 */
export const resolveFolderPath = (
  folders: ReadonlyArray<FolderNode>,
  path: string,
): string | null => {
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  let parentId: string | null = null;
  let resolvedId: string | null = null;
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    const match = folders.find(
      (f) => (f.parentId ?? null) === parentId && f.name.toLowerCase() === lower,
    );
    if (!match) return null;
    resolvedId = match.id;
    parentId = match.id;
  }
  return resolvedId;
};

/**
 * Folders whose full path prefix- or substring-matches `needle`
 * (case-insensitive). Prefix matches rank first — parallels `filterTags`.
 * An empty needle returns every folder.
 */
export const filterFolderPaths = (
  folders: ReadonlyArray<FolderNode>,
  needle: string,
): FolderNode[] => {
  const n = needle.trim().toLowerCase();
  if (n === '') return folders.slice();
  const prefix: FolderNode[] = [];
  const contains: FolderNode[] = [];
  for (const f of folders) {
    const path = folderPath(folders, f.id).toLowerCase();
    if (path.startsWith(n)) prefix.push(f);
    else if (path.includes(n)) contains.push(f);
  }
  return [...prefix, ...contains];
};
