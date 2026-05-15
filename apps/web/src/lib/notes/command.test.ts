import { describe, expect, it } from 'vitest';
import type { TagItem } from '@/lib/api/schemas.ts';
import { filterTags, parseCommand, resolveTagId } from './command.ts';

const tags: TagItem[] = [
  { id: 't1', name: 'discovery', color: '#C26A20' },
  { id: 't2', name: 'pricing', color: null },
  { id: 't3', name: 'discovery#new#01', color: null },
];

describe('parseCommand', () => {
  it('returns empty for blank input', () => {
    expect(parseCommand('')).toEqual({ kind: 'empty' });
    expect(parseCommand('   ')).toEqual({ kind: 'empty' });
  });

  it('routes a # prefix to tag mode (lowercased, # stripped)', () => {
    expect(parseCommand('#Discovery')).toEqual({ kind: 'tag', needle: 'discovery' });
    expect(parseCommand('  #discovery#new  ')).toEqual({
      kind: 'tag',
      needle: 'discovery#new',
    });
  });

  it('routes a / prefix to folder mode (case preserved, / stripped)', () => {
    expect(parseCommand('/Clients')).toEqual({ kind: 'folder', path: 'Clients' });
    expect(parseCommand('  /Clients/Intech/Support  ')).toEqual({
      kind: 'folder',
      path: 'Clients/Intech/Support',
    });
  });

  it('routes anything else to text mode', () => {
    expect(parseCommand('quarterly plan')).toEqual({ kind: 'text', q: 'quarterly plan' });
  });
});

describe('filterTags', () => {
  it('ranks prefix matches above substring matches', () => {
    const out = filterTags(tags, 'dis');
    expect(out.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('surfaces nested tags under a parent-path needle', () => {
    expect(filterTags(tags, 'discovery').map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('returns the unfiltered list for an empty needle', () => {
    expect(filterTags(tags, '').length).toBe(tags.length);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterTags(tags, 'zzz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterTags(tags, 'DISC').length).toBe(2);
  });
});

describe('resolveTagId', () => {
  it('resolves an exact (case-insensitive) name to its id', () => {
    expect(resolveTagId(tags, 'discovery')).toBe('t1');
    expect(resolveTagId(tags, 'DISCOVERY#NEW#01')).toBe('t3');
  });

  it('returns null for a partial needle', () => {
    expect(resolveTagId(tags, 'disc')).toBeNull();
  });

  it('returns null for an empty needle', () => {
    expect(resolveTagId(tags, '')).toBeNull();
  });
});
