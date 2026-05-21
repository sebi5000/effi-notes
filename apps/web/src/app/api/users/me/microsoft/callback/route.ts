import { env } from '@app/config/env';
import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { requireSession } from '@/lib/api/responses.ts';
import {
  codeExchangeBody,
  decodeIdTokenClaims,
  isMicrosoftConfigured,
  SCOPES,
  tokenEndpoint,
  tokenResponseSchema,
  verifyState,
} from '@/lib/microsoft/oauth.ts';

/**
 * GET /api/users/me/microsoft/callback — Microsoft redirects the browser
 * back here with `?code=...&state=...` after the user grants consent
 * (ADR 0031).
 *
 * We validate the state (HMAC over AUTH_SECRET), exchange the code for
 * tokens, decode the id_token's tid/oid/upn claims, upsert the
 * MicrosoftAccount row, audit, and bounce back to /settings with a status
 * query so the card can render a banner.
 *
 * Failure modes all redirect to /settings with `?microsoft=<error>` so the
 * card can show a localised message — never just dumps a stack to the user.
 */

const log = createLogger({ component: 'api.users.me.microsoft.callback' });

const back = (status: string): Response => {
  const url = new URL('/settings', env.APP_BASE_URL);
  url.searchParams.set('microsoft', status);
  return Response.redirect(url.toString(), 302);
};

export const GET = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return back('unauthorised');
  if (!isMicrosoftConfigured()) return back('not-configured');

  const u = new URL(req.url);
  // User can cancel from Microsoft's consent page; preserve the error.
  const oauthError = u.searchParams.get('error');
  if (oauthError !== null) {
    log.warn({ userId: user.id, oauthError }, 'microsoft consent denied');
    return back('denied');
  }

  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || !state) return back('malformed');

  const verified = verifyState(state);
  if (!verified.ok) {
    log.warn({ userId: user.id, reason: verified.reason }, 'microsoft state rejected');
    return back('bad-state');
  }
  // State binds to a specific user — even a leaked state can't be used to
  // attach Microsoft tokens to a different account.
  if (verified.userId !== user.id) {
    log.warn(
      { sessionUserId: user.id, stateUserId: verified.userId },
      'microsoft state user mismatch',
    );
    return back('user-mismatch');
  }

  // Exchange code for tokens.
  const tokenRes = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: codeExchangeBody(code).toString(),
  });
  if (!tokenRes.ok) {
    log.warn({ userId: user.id, status: tokenRes.status }, 'microsoft code exchange failed');
    return back('token-exchange-failed');
  }

  const parsed = tokenResponseSchema.safeParse(await tokenRes.json());
  if (!parsed.success) {
    log.error({ userId: user.id, issues: parsed.error.issues }, 'malformed token response');
    return back('token-exchange-failed');
  }
  if (!parsed.data.refresh_token) {
    // Without offline_access the user can't be kept connected; Microsoft
    // also omits the refresh_token if the scope was downgraded mid-flow.
    return back('no-refresh-token');
  }
  if (!parsed.data.id_token) return back('no-id-token');

  const claims = decodeIdTokenClaims(parsed.data.id_token);
  if (!claims) return back('bad-id-token');

  await prisma.microsoftAccount.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      tenantId: claims.tid,
      oid: claims.oid,
      ...(claims.preferred_username ? { upn: claims.preferred_username } : {}),
      refreshToken: parsed.data.refresh_token,
      scopes: parsed.data.scope ?? SCOPES,
    },
    update: {
      tenantId: claims.tid,
      oid: claims.oid,
      ...(claims.preferred_username ? { upn: claims.preferred_username } : {}),
      refreshToken: parsed.data.refresh_token,
      scopes: parsed.data.scope ?? SCOPES,
    },
  });
  await recordAudit({
    action: 'microsoft.account.linked',
    actorId: user.id,
    subject: user.id,
    metadata: { tenantId: claims.tid, upn: claims.preferred_username ?? null },
  });
  log.info({ userId: user.id, upn: claims.preferred_username }, 'microsoft account linked');

  return back('connected');
};
