import { describe, expect, it } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import {
  ancestorChain,
  buildFolderTree,
  childrenOf,
  computeReorder,
  computeRootReorder,
  flatten,
  isDescendant,
  isNoopReorder,
  moveSelection,
  resolveDropMode,
} from './folder-tree.ts';

const f = (id: string, name: string, parentId: string | null = null, position = 0): FolderNode => ({
  id,
  name,
  parentId,
  position,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
});

const fixture: FolderNode[] = [
  f('clients', 'Clients', null, 0),
  f('acme', 'Acme', 'clients', 0),
  f('globex', 'Globex', 'clients', 1),
  f('internal', 'Internal', null, 1),
  f('playbooks', 'Playbooks', 'internal', 0),
];

describe('buildFolderTree', () => {
  it('groups children under their parent', () => {
    const tree = buildFolderTree(fixture);
    expect(tree.map((n) => n.id)).toEqual(['clients', 'internal']);
    const clients = tree[0];
    expect(clients?.children.map((c) => c.id)).toEqual(['acme', 'globex']);
  });

  it('orders siblings by position then name', () => {
    const tree = buildFolderTree([
      f('a', 'Zeta', null, 1),
      f('b', 'Alpha', null, 1),
      f('c', 'Bravo', null, 0),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Bravo', 'Alpha', 'Zeta']);
  });

  it('promotes orphans whose parent is missing to roots', () => {
    const tree = buildFolderTree([f('a', 'A', 'missing-parent', 0)]);
    expect(tree.map((n) => n.id)).toEqual(['a']);
  });
});

describe('flatten', () => {
  it('includes only roots when nothing is expanded', () => {
    const flat = flatten(buildFolderTree(fixture), new Set());
    expect(flat.map((n) => n.id)).toEqual(['clients', 'internal']);
    expect(flat[0]?.depth).toBe(0);
    expect(flat[0]?.hasChildren).toBe(true);
  });

  it('reveals children when a parent is expanded', () => {
    const flat = flatten(buildFolderTree(fixture), new Set(['clients']));
    expect(flat.map((n) => n.id)).toEqual(['clients', 'acme', 'globex', 'internal']);
    expect(flat[1]?.depth).toBe(1);
  });
});

describe('moveSelection', () => {
  const visible = flatten(buildFolderTree(fixture), new Set(['clients']));

  it('returns the first visible when current is null', () => {
    expect(moveSelection(visible, null, 'down')).toBe('clients');
  });

  it('moves down through visible rows', () => {
    expect(moveSelection(visible, 'clients', 'down')).toBe('acme');
    expect(moveSelection(visible, 'acme', 'down')).toBe('globex');
  });

  it('moves up through visible rows', () => {
    expect(moveSelection(visible, 'globex', 'up')).toBe('acme');
    expect(moveSelection(visible, 'acme', 'up')).toBe('clients');
  });

  it('clamps at boundaries', () => {
    expect(moveSelection(visible, 'clients', 'up')).toBe('clients');
    const last = visible.at(-1)?.id ?? '';
    expect(moveSelection(visible, last, 'down')).toBe(last);
  });

  it('returns null when no visible items', () => {
    expect(moveSelection([], null, 'down')).toBeNull();
  });

  it('jumps to first visible if current is not in the visible set', () => {
    expect(moveSelection(visible, 'unknown', 'down')).toBe('clients');
  });
});

describe('ancestorChain', () => {
  it('walks parent links to the root', () => {
    expect(ancestorChain(fixture, 'acme')).toEqual(['clients', 'acme']);
    expect(ancestorChain(fixture, 'playbooks')).toEqual(['internal', 'playbooks']);
  });

  it('handles a missing target', () => {
    expect(ancestorChain(fixture, 'missing')).toEqual([]);
  });

  it('does not infinite-loop on a cyclic graph (defensive)', () => {
    const cyclic: FolderNode[] = [f('a', 'A', 'b', 0), f('b', 'B', 'a', 0)];
    const chain = ancestorChain(cyclic, 'a');
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

describe('isDescendant (cycle guard)', () => {
  it('is true for the same id (a folder is its own descendant)', () => {
    expect(isDescendant(fixture, 'acme', 'acme')).toBe(true);
  });

  it('is true for a direct child', () => {
    expect(isDescendant(fixture, 'clients', 'acme')).toBe(true);
  });

  it('is false for a sibling', () => {
    expect(isDescendant(fixture, 'acme', 'globex')).toBe(false);
  });

  it('is false for an unrelated tree', () => {
    expect(isDescendant(fixture, 'clients', 'playbooks')).toBe(false);
  });

  it('is true for a grandchild via nested fixture', () => {
    const nested: FolderNode[] = [
      f('root', 'Root', null, 0),
      f('mid', 'Mid', 'root', 0),
      f('leaf', 'Leaf', 'mid', 0),
    ];
    expect(isDescendant(nested, 'root', 'leaf')).toBe(true);
  });

  it('does not infinite-loop on a cyclic graph', () => {
    const cyclic: FolderNode[] = [f('a', 'A', 'b', 0), f('b', 'B', 'a', 0)];
    expect(isDescendant(cyclic, 'a', 'b')).toBe(true);
  });
});

describe('childrenOf', () => {
  it('returns the direct children of a parent, position-ordered', () => {
    expect(childrenOf(fixture, 'clients').map((c) => c.id)).toEqual(['acme', 'globex']);
  });

  it('returns root folders for parentId null', () => {
    expect(childrenOf(fixture, null).map((c) => c.id)).toEqual(['clients', 'internal']);
  });

  it('breaks position ties by name', () => {
    const tied: FolderNode[] = [f('z', 'Zeta', null, 0), f('a', 'Alpha', null, 0)];
    expect(childrenOf(tied, null).map((c) => c.id)).toEqual(['a', 'z']);
  });

  it('returns an empty list for a leaf folder', () => {
    expect(childrenOf(fixture, 'acme')).toEqual([]);
  });
});

describe('resolveDropMode', () => {
  const rect = { top: 100, height: 40 };
  it('maps the top quarter to before', () => {
    expect(resolveDropMode(rect, 105)).toBe('before'); // ratio 0.125
  });
  it('maps the middle half to inside', () => {
    expect(resolveDropMode(rect, 120)).toBe('inside'); // ratio 0.5
  });
  it('maps the bottom quarter to after', () => {
    expect(resolveDropMode(rect, 135)).toBe('after'); // ratio 0.875
  });
  it('falls back to inside for a zero-height rect (jsdom)', () => {
    expect(resolveDropMode({ top: 0, height: 0 }, 0)).toBe('inside');
  });
});

describe('computeReorder', () => {
  it('inside: appends the dragged folder to the target children', () => {
    // globex has no children → drop internal inside it
    const plan = computeReorder(fixture, 'internal', 'globex', 'inside');
    expect(plan).toEqual({ parentId: 'globex', orderedIds: ['internal'] });
  });

  it('inside: nesting into a populated folder appends after existing children', () => {
    const plan = computeReorder(fixture, 'internal', 'clients', 'inside');
    expect(plan).toEqual({ parentId: 'clients', orderedIds: ['acme', 'globex', 'internal'] });
  });

  it('before: inserts the dragged folder ahead of the target sibling', () => {
    const plan = computeReorder(fixture, 'globex', 'acme', 'before');
    expect(plan).toEqual({ parentId: 'clients', orderedIds: ['globex', 'acme'] });
  });

  it('after: inserts the dragged folder behind the target sibling', () => {
    const plan = computeReorder(fixture, 'acme', 'globex', 'after');
    expect(plan).toEqual({ parentId: 'clients', orderedIds: ['globex', 'acme'] });
  });

  it('before/after re-parents when the target lives elsewhere', () => {
    // internal is a root; dropping it before acme makes it a child of clients
    const plan = computeReorder(fixture, 'internal', 'acme', 'before');
    expect(plan).toEqual({ parentId: 'clients', orderedIds: ['internal', 'acme', 'globex'] });
  });

  it('returns null when dropping a folder onto itself', () => {
    expect(computeReorder(fixture, 'acme', 'acme', 'inside')).toBeNull();
  });

  it('returns null for an inside-drop into the folder’s own subtree (cycle)', () => {
    expect(computeReorder(fixture, 'clients', 'acme', 'inside')).toBeNull();
  });

  it('returns null for an unknown dragged or target id', () => {
    expect(computeReorder(fixture, 'ghost', 'acme', 'inside')).toBeNull();
    expect(computeReorder(fixture, 'acme', 'ghost', 'before')).toBeNull();
  });
});

describe('computeRootReorder', () => {
  it('appends the dragged folder to the root level', () => {
    const plan = computeRootReorder(fixture, 'acme');
    expect(plan).toEqual({ parentId: null, orderedIds: ['clients', 'internal', 'acme'] });
  });

  it('keeps an already-root folder, moved to the end', () => {
    const plan = computeRootReorder(fixture, 'clients');
    expect(plan).toEqual({ parentId: null, orderedIds: ['internal', 'clients'] });
  });

  it('returns null for an unknown id', () => {
    expect(computeRootReorder(fixture, 'ghost')).toBeNull();
  });
});

describe('isNoopReorder', () => {
  it('is true when the plan matches the current order exactly', () => {
    expect(isNoopReorder(fixture, { parentId: 'clients', orderedIds: ['acme', 'globex'] })).toBe(
      true,
    );
  });

  it('is false when the order differs', () => {
    expect(isNoopReorder(fixture, { parentId: 'clients', orderedIds: ['globex', 'acme'] })).toBe(
      false,
    );
  });

  it('is false when the membership differs', () => {
    expect(isNoopReorder(fixture, { parentId: 'clients', orderedIds: ['acme'] })).toBe(false);
  });
});
