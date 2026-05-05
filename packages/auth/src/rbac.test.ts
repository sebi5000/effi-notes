import { describe, expect, it } from 'vitest';
import { ForbiddenError, hasRole, requireRole } from './rbac.ts';

const userOnly = { roles: ['user' as const] };
const adminOnly = { roles: ['admin' as const] };
const opsAdmin = { roles: ['ops' as const, 'admin' as const] };
const empty = { roles: [] };

describe('hasRole', () => {
  it('returns false for null / undefined user', () => {
    expect(hasRole(null, 'user')).toBe(false);
    expect(hasRole(undefined, 'admin')).toBe(false);
  });

  it('returns false when roles array is empty', () => {
    expect(hasRole(empty, 'user')).toBe(false);
  });

  it('matches a single required role', () => {
    expect(hasRole(adminOnly, 'admin')).toBe(true);
    expect(hasRole(adminOnly, 'user')).toBe(false);
  });

  it('matches when ANY required role is present (union semantics)', () => {
    expect(hasRole(opsAdmin, ['user', 'ops'])).toBe(true);
    expect(hasRole(userOnly, ['admin', 'ops'])).toBe(false);
  });

  it('does not imply a hierarchy — admin does not grant user', () => {
    // Roles are flat. Customer projects that want hierarchy implement it
    // explicitly; the template stays unopinionated.
    expect(hasRole(adminOnly, 'user')).toBe(false);
  });
});

describe('requireRole', () => {
  it('returns void when authorised', () => {
    expect(() => requireRole(adminOnly, 'admin')).not.toThrow();
    expect(() => requireRole(opsAdmin, ['user', 'admin'])).not.toThrow();
  });

  it('throws ForbiddenError when unauthorised', () => {
    expect(() => requireRole(userOnly, 'admin')).toThrow(ForbiddenError);
    expect(() => requireRole(null, 'user')).toThrow(ForbiddenError);
  });

  it('attaches the required roles to the thrown error', () => {
    try {
      requireRole(userOnly, ['admin', 'ops']);
      throw new Error('should not reach here');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      if (err instanceof ForbiddenError) {
        expect(err.required).toEqual(['admin', 'ops']);
      }
    }
  });
});
