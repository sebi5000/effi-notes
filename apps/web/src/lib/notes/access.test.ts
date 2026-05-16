import { describe, expect, it } from 'vitest';
import { atLeast, canEdit, canHardDelete, canManageShares } from './access.ts';

describe('access rank helpers', () => {
  it('atLeast compares the rank ladder', () => {
    expect(atLeast('OWNER', 'VIEW')).toBe(true);
    expect(atLeast('EDIT', 'EDIT')).toBe(true);
    expect(atLeast('VIEW', 'EDIT')).toBe(false);
    expect(atLeast(null, 'VIEW')).toBe(false);
  });

  it('canEdit / canManageShares need EDIT or higher', () => {
    expect(canEdit('EDIT')).toBe(true);
    expect(canEdit('VIEW')).toBe(false);
    expect(canManageShares('OWNER')).toBe(true);
    expect(canManageShares('VIEW')).toBe(false);
    expect(canManageShares(null)).toBe(false);
  });

  it('canHardDelete needs OWNER', () => {
    expect(canHardDelete('OWNER')).toBe(true);
    expect(canHardDelete('EDIT')).toBe(false);
  });
});
