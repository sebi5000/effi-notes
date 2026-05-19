import { describe, expect, it } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import { folderInternalUrl, noteInternalUrl } from './internal-url.ts';

const folder = (id: string, name: string, parentId: string | null = null): FolderNode => ({
  id,
  name,
  parentId,
  position: 0,
  icon: 'folder',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  shareCount: 0,
});

describe('noteInternalUrl', () => {
  it('builds the note path', () => {
    expect(noteInternalUrl('note-123')).toBe('/notes/note-123');
  });
});

describe('folderInternalUrl', () => {
  const folders = [folder('a', 'Clients'), folder('b', 'Acme', 'a')];

  it('encodes a nested folder path as a query filter', () => {
    expect(folderInternalUrl(folders, 'b')).toBe(`/notes?q=${encodeURIComponent('/Clients/Acme')}`);
  });

  it('falls back to /notes for an unresolvable folder', () => {
    expect(folderInternalUrl(folders, 'missing')).toBe('/notes');
  });
});
