import { describe, expect, it } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import { partitionSharedFolders } from './shared-folders.ts';

const folder = (id: string, parentId: string | null, shared = false): FolderNode => ({
  id,
  name: id,
  parentId,
  position: 0,
  icon: 'folder',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
  shareCount: 0,
  ...(shared
    ? { sharedWithMe: { shareId: `s-${id}`, sharedByName: 'Alice', access: 'VIEW', seenAt: null } }
    : {}),
});

describe('partitionSharedFolders', () => {
  it('puts owned folders in `own` and shared roots in `shared`', () => {
    const { own, shared } = partitionSharedFolders([
      folder('mine', null),
      folder('theirs', null, true),
    ]);
    expect(own.map((f) => f.id)).toEqual(['mine']);
    expect(shared.map((f) => f.id)).toEqual(['theirs']);
  });

  it('treats a descendant of a shared root as shared', () => {
    const { own, shared } = partitionSharedFolders([
      folder('root', null, true),
      folder('child', 'root'),
      folder('grandchild', 'child'),
    ]);
    expect(own).toHaveLength(0);
    expect(shared.map((f) => f.id).sort()).toEqual(['child', 'grandchild', 'root']);
  });

  it('keeps an owned folder owned even when other folders are shared', () => {
    const { own, shared } = partitionSharedFolders([
      folder('a', null),
      folder('b', null, true),
      folder('b-child', 'b'),
    ]);
    expect(own.map((f) => f.id)).toEqual(['a']);
    expect(shared.map((f) => f.id).sort()).toEqual(['b', 'b-child']);
  });

  it('returns two empty arrays for an empty input', () => {
    const { own, shared } = partitionSharedFolders([]);
    expect(own).toEqual([]);
    expect(shared).toEqual([]);
  });
});
