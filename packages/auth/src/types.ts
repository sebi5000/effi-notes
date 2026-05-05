// Force module resolution so the augmentation below is actually picked up.
// Without these imports, `moduleResolution: bundler` only loads modules that
// are *value*-imported elsewhere, and our augmentation silently does nothing.
import type {} from '@auth/core/jwt';
import type {} from 'next-auth';

/**
 * Roles known to the template. Customer projects extend this union by
 * editing the `Role` type AND adding the role to the Keycloak realm
 * (deploy/keycloak/realm-export.json) — both must stay in sync.
 *
 * Treat the order as a default precedence (most → least privileged) for
 * humans reading the source. RBAC checks are explicit (no implicit
 * hierarchy), so adding a role is purely additive.
 */
export type Role = 'admin' | 'ops' | 'user';

export const ALL_ROLES: ReadonlyArray<Role> = ['admin', 'ops', 'user'] as const;

/**
 * Shape of the application user attached to every authenticated request.
 * Sourced from the auth.js JWT and refreshed on token refresh.
 */
export type AppUser = {
  /** `User.id` from our database (cuid). Source of truth for app-internal references. */
  id: string;
  /** Keycloak `sub` claim. Stable across email changes. */
  keycloakSub: string;
  email: string;
  displayName: string | null;
  locale: string;
  roles: ReadonlyArray<Role>;
};

/**
 * Augments the auth.js Session and JWT with our typed user. Imported via
 * the side-effect `import '@app/auth'` once at the auth.js entry point —
 * see apps/web/src/auth.ts.
 */
declare module 'next-auth' {
  interface Session {
    user: AppUser;
    /** Set when the upstream refresh-token call has failed. The caller should sign the user out. */
    error?: 'RefreshAccessTokenError';
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    appUser: AppUser;
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    error?: 'RefreshAccessTokenError';
  }
}
