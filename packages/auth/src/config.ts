import { env } from '@app/config/env';
import { prisma } from '@app/db';
import type { JWT } from '@auth/core/jwt';
import type { NextAuthConfig } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';
// Side-effect import: registers the Session/JWT module augmentation.
import './types.ts';
import type { AppUser, Role } from './types.ts';

/**
 * Refresh access token via Keycloak's token endpoint.
 *
 * Auth.js does not refresh OIDC tokens automatically — we must do it
 * ourselves so the access_token in the JWT stays usable for subsequent
 * Keycloak Admin API calls or downstream service tokens.
 */
const refreshAccessToken = async (
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> => {
  const url = `${env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.KEYCLOAK_CLIENT_ID,
      client_secret: env.KEYCLOAK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Keycloak token refresh failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
};

/**
 * Upsert the application user mirror on first login. Source of truth
 * for identity stays in Keycloak; we cache the projection so foreign
 * keys (audit-log actorId, customer-domain entities) can reference a
 * stable internal id.
 */
const upsertUser = async (claims: {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  locale?: string;
  roles?: string[];
}): Promise<AppUser> => {
  const knownRoles: ReadonlyArray<Role> = ['admin', 'ops', 'user'];
  const roles = (claims.roles ?? []).filter((r): r is Role =>
    (knownRoles as ReadonlyArray<string>).includes(r),
  );

  const displayName = claims.name ?? claims.preferred_username ?? null;
  const user = await prisma.user.upsert({
    where: { keycloakSub: claims.sub },
    create: {
      keycloakSub: claims.sub,
      email: claims.email,
      displayName,
      locale: claims.locale ?? 'de',
      roles: [...roles],
      lastSeenAt: new Date(),
    },
    update: {
      email: claims.email,
      displayName,
      ...(claims.locale ? { locale: claims.locale } : {}),
      roles: [...roles],
      lastSeenAt: new Date(),
    },
  });

  return {
    id: user.id,
    keycloakSub: user.keycloakSub,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    roles: roles,
  };
};

// Local alias capturing the fields WE add to the JWT. The module
// augmentation in `./types.ts` makes these visible on the global JWT
// type at consumer sites; inside this file we name them explicitly so
// the callback bodies stay narrow even if upstream type inference
// drifts between auth.js v5 beta releases.
type AppJWT = JWT & {
  appUser: AppUser;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  error?: 'RefreshAccessTokenError';
};

export const authConfig = {
  providers: [
    Keycloak({
      clientId: env.KEYCLOAK_CLIENT_ID,
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      issuer: env.KEYCLOAK_ISSUER,
    }),
  ],
  session: { strategy: 'jwt' },
  trustHost: env.AUTH_TRUST_HOST,
  secret: env.AUTH_SECRET,
  pages: {
    signIn: '/login',
  },
  callbacks: {
    /**
     * Build / refresh the JWT. Runs on every request that needs the
     * session, so keep it cheap. DB writes happen only at sign-in
     * (account is non-null) and on token refresh.
     */
    async jwt({ token, account, profile }) {
      const t = token as AppJWT;

      if (account && profile) {
        const claims = profile as {
          sub: string;
          email: string;
          name?: string;
          preferred_username?: string;
          locale?: string;
          roles?: string[];
        };
        t.appUser = await upsertUser(claims);
        t.accessToken = account.access_token ?? '';
        t.refreshToken = (account.refresh_token as string | undefined) ?? '';
        t.accessTokenExpiresAt = account.expires_at ?? 0;
        return t;
      }

      // Token still valid (with 30s safety margin)
      const now = Math.floor(Date.now() / 1000);
      if (t.accessTokenExpiresAt && now < t.accessTokenExpiresAt - 30) {
        return t;
      }

      // Refresh
      try {
        const refreshed = await refreshAccessToken(t.refreshToken);
        t.accessToken = refreshed.accessToken;
        t.refreshToken = refreshed.refreshToken;
        t.accessTokenExpiresAt = refreshed.expiresAt;
        delete t.error;
        return t;
      } catch {
        t.error = 'RefreshAccessTokenError';
        return t;
      }
    },

    /** Project the JWT onto the session object exposed to the app. */
    session({ session, token }) {
      const t = token as AppJWT;
      // The augmented Session.user (in ./types.ts) is exactly AppUser;
      // upstream's inferred parameter type still merges AdapterUser, so
      // we widen via `as never` and rely on the augmentation at consumer
      // sites where `session.user` reads as AppUser.
      session.user = t.appUser as never;
      if (t.error) session.error = t.error;
      return session;
    },
  },
} satisfies NextAuthConfig;
