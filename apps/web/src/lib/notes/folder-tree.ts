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
