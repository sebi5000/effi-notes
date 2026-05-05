import type { AppUser, Role } from './types.ts';

/**
 * Predicate. Pure, no I/O. Use everywhere — server, edge, client.
 */
export const hasRole = (
  user: Pick<AppUser, 'roles'> | null | undefined,
  required: Role | ReadonlyArray<Role>,
): boolean => {
  if (!user) return false;
  const need = Array.isArray(required) ? required : [required];
  return need.some((r) => user.roles.includes(r));
};

/**
 * Server-side guard for route handlers and server actions. Throws on
 * missing role; pair with a Next.js error boundary, or call after a
 * successful `auth()` so the redirect-to-login path runs first.
 */
export class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError';
  readonly required: ReadonlyArray<Role>;

  constructor(required: Role | ReadonlyArray<Role>) {
    const need = Array.isArray(required) ? required : [required];
    super(`Forbidden — required role: ${need.join(' | ')}`);
    this.required = need;
  }
}

export const requireRole = (
  user: Pick<AppUser, 'roles'> | null | undefined,
  required: Role | ReadonlyArray<Role>,
): void => {
  if (!hasRole(user, required)) throw new ForbiddenError(required);
};
