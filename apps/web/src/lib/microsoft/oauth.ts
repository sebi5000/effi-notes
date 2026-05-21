import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@app/config/env';
import { z } from 'zod';

/**
 * Pure helpers for the Microsoft 365 OAuth code-grant flow (ADR 0031).
 *
 * Every value the browser ever sees passes through here so the call sites
 * (the authorize + callback routes) stay small. No fetch calls live in this
 * file — they're in `tokens.ts` so the OAuth shape is testable in isolation.
 */

export const SCOPES = 'offline_access Calendars.Read';

/**
 * Microsoft 365 is opt-in per-customer. `isMicrosoftConfigured()` returns
 * true only when all three env vars are set; the feature degrades to "not
 * configured" otherwise.
 */
export const isMicrosoftConfigured = (): boolean =>
  env.MICROSOFT_TENANT_ID !== undefined &&
  env.MICROSOFT_CLIENT_ID !== undefined &&
  env.MICROSOFT_CLIENT_SECRET !== undefined;

/** Narrow accessor used by `tokens.ts` and the routes — throws if unset. */
export const microsoftConfig = (): {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} => {
  if (!isMicrosoftConfigured()) {
    throw new Error('microsoft 365 is not configured');
  }
  return {
    tenantId: env.MICROSOFT_TENANT_ID ?? '',
    clientId: env.MICROSOFT_CLIENT_ID ?? '',
    clientSecret: env.MICROSOFT_CLIENT_SECRET ?? '',
    redirectUri: `${env.APP_BASE_URL.replace(/\/$/, '')}/api/users/me/microsoft/callback`,
  };
};

/**
 * State carries the user id + a random nonce signed under AUTH_SECRET.
 * Format: `<userIdB64>.<nonceB64>.<sigB64>` (all base64url, no padding).
 *
 *   userId : the app User.id the flow belongs to — verified against the
 *            session on callback so a leaked state can't grant a different
 *            account's token storage
 *   nonce  : 16 random bytes; prevents replay if the same user starts two
 *            simultaneous flows
 *   sig    : HMAC-SHA256(AUTH_SECRET, `${userId}:${nonce}`)
 *
 * Verification is constant-time.
 */
const STATE_NONCE_BYTES = 16;
const b64 = (b: Buffer): string => b.toString('base64url');
const b64dec = (s: string): Buffer => Buffer.from(s, 'base64url');

export const signState = (userId: string): string => {
  const nonce = randomBytes(STATE_NONCE_BYTES);
  const sig = createHmac('sha256', env.AUTH_SECRET)
    .update(`${userId}:${b64(nonce)}`)
    .digest();
  return `${b64(Buffer.from(userId, 'utf8'))}.${b64(nonce)}.${b64(sig)}`;
};

export type StateVerification =
  | { ok: true; userId: string }
  | { ok: false; reason: 'malformed' | 'bad-signature' };

export const verifyState = (state: string): StateVerification => {
  const parts = state.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [userIdB64, nonceB64, sigB64] = parts as [string, string, string];
  let userIdBuf: Buffer;
  let nonceBuf: Buffer;
  let sigBuf: Buffer;
  try {
    userIdBuf = b64dec(userIdB64);
    nonceBuf = b64dec(nonceB64);
    sigBuf = b64dec(sigB64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const userId = userIdBuf.toString('utf8');
  const expected = createHmac('sha256', env.AUTH_SECRET)
    .update(`${userId}:${b64(nonceBuf)}`)
    .digest();
  // `timingSafeEqual` requires equal-length inputs; the sigBuf check above
  // catches a malformed length earlier, but be defensive.
  if (sigBuf.length !== expected.length) return { ok: false, reason: 'bad-signature' };
  if (!timingSafeEqual(sigBuf, expected)) return { ok: false, reason: 'bad-signature' };
  return { ok: true, userId };
};

/**
 * Microsoft's authorize endpoint. The browser is redirected here; the user
 * grants consent; Microsoft redirects them back to `redirectUri` with
 * `?code=...&state=...`.
 */
export const buildAuthorizeUrl = (state: string): string => {
  const cfg = microsoftConfig();
  const u = new URL(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', state);
  // `prompt=select_account` lets the user pick which Microsoft account to
  // link — useful when they're already signed into a different one.
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
};

/** Microsoft token endpoint — used by both code-exchange and refresh. */
export const tokenEndpoint = (): string => {
  const cfg = microsoftConfig();
  return `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
};

/**
 * Body for the initial code-for-tokens exchange. Returned as
 * URLSearchParams so the route can `await fetch(..., { body })` directly.
 */
export const codeExchangeBody = (code: string): URLSearchParams => {
  const cfg = microsoftConfig();
  const body = new URLSearchParams();
  body.set('client_id', cfg.clientId);
  body.set('client_secret', cfg.clientSecret);
  body.set('code', code);
  body.set('redirect_uri', cfg.redirectUri);
  body.set('grant_type', 'authorization_code');
  body.set('scope', SCOPES);
  return body;
};

/** Body for the refresh-token exchange. */
export const refreshExchangeBody = (refreshToken: string): URLSearchParams => {
  const cfg = microsoftConfig();
  const body = new URLSearchParams();
  body.set('client_id', cfg.clientId);
  body.set('client_secret', cfg.clientSecret);
  body.set('refresh_token', refreshToken);
  body.set('grant_type', 'refresh_token');
  body.set('scope', SCOPES);
  return body;
};

/**
 * Microsoft's token response. `refresh_token` is OPTIONAL — Microsoft only
 * returns a new one when it rotates the existing one; absent means "keep
 * using the one you already have."
 */
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.literal('Bearer'),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/**
 * Minimal id_token claims we read. Microsoft's id_tokens are full JWTs but
 * we only need `tid` (tenant), `oid` (Microsoft user object id), and
 * `preferred_username` (display upn). Parsed without signature verification
 * because we received it directly from `login.microsoftonline.com` over TLS
 * inside the same code-exchange round-trip — there's no man-in-the-middle
 * attack surface here that signature verification would close.
 */
export const idTokenClaimsSchema = z.object({
  tid: z.string().min(1),
  oid: z.string().min(1),
  preferred_username: z.string().optional(),
});
export type IdTokenClaims = z.infer<typeof idTokenClaimsSchema>;

export const decodeIdTokenClaims = (idToken: string): IdTokenClaims | null => {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'),
    ) as unknown;
    const parsed = idTokenClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
