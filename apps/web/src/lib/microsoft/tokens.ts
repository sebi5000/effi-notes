import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import {
  isMicrosoftConfigured,
  refreshExchangeBody,
  tokenEndpoint,
  tokenResponseSchema,
} from './oauth.ts';

/**
 * Token management for the Microsoft 365 integration (ADR 0031).
 *
 * Access tokens are short-lived (~1 h) and NEVER persisted — every call to
 * `getMicrosoftAccessToken(userId)` exchanges the persisted refresh token
 * for a fresh access token via Microsoft's token endpoint. If Microsoft
 * rotates the refresh token (it sometimes does), the new one is persisted
 * before the function returns — silent rotation loss is the most common way
 * an integration "randomly disconnects" weeks later.
 */

const log = createLogger({ component: 'microsoft.tokens' });

export type AccessTokenResult =
  | { ok: true; accessToken: string; expiresInSec: number }
  | { ok: false; reason: 'not-connected' | 'not-configured' | 'refresh-failed' };

/**
 * Returns a fresh Microsoft Graph access token for `userId`, or a typed
 * failure that the caller maps to an HTTP status (typically 412 Precondition
 * Failed → "Connect Microsoft 365"). Persists a rotated refresh token if
 * Microsoft returned one. Deletes the row + returns 'refresh-failed' when
 * the refresh token itself is no longer valid (user revoked consent or
 * Microsoft expired it) so the next caller prompts the user to reconnect.
 *
 * `fetcher` is injectable for tests — pass `globalThis.fetch` in production.
 */
export const getMicrosoftAccessToken = async (
  userId: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<AccessTokenResult> => {
  if (!isMicrosoftConfigured()) return { ok: false, reason: 'not-configured' };

  const account = await prisma.microsoftAccount.findUnique({
    where: { userId },
    select: { refreshToken: true },
  });
  if (!account) return { ok: false, reason: 'not-connected' };

  const res = await fetcher(tokenEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: refreshExchangeBody(account.refreshToken).toString(),
  });

  if (!res.ok) {
    // 400 from Microsoft typically means invalid_grant (refresh token
    // revoked or expired). Drop the row so the UI prompts a reconnect.
    log.warn({ userId, status: res.status }, 'microsoft refresh failed');
    if (res.status >= 400 && res.status < 500) {
      await prisma.microsoftAccount
        .delete({ where: { userId } })
        .catch(() => undefined /* already gone */);
    }
    return { ok: false, reason: 'refresh-failed' };
  }

  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    log.error({ userId, issues: parsed.error.issues }, 'malformed microsoft token response');
    return { ok: false, reason: 'refresh-failed' };
  }

  // Persist rotated refresh token if Microsoft returned a new one — silent
  // rotation loss is the textbook cause of "I was connected last week and
  // now I'm not" support tickets.
  if (parsed.data.refresh_token && parsed.data.refresh_token !== account.refreshToken) {
    await prisma.microsoftAccount.update({
      where: { userId },
      data: { refreshToken: parsed.data.refresh_token },
    });
  }

  return {
    ok: true,
    accessToken: parsed.data.access_token,
    expiresInSec: parsed.data.expires_in,
  };
};
