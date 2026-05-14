import { describe, expect, it } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import { ancestorChain, buildFolderTree, flatten, moveSelection } from './folder-tree.ts';

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
