// Catch-all auth.js endpoint: callbacks, sign-in / sign-out, CSRF token,
// session JSON.
//
// Rate-limit scope:
//
//   /api/auth/signin           — start of the OIDC flow
//   /api/auth/signin/<provider>
//   /api/auth/callback/<provider>
//   /api/auth/signout
//
// Hot per-page-load endpoints like /api/auth/session and /api/auth/csrf
// are NOT rate-limited — every authenticated page render hits them, and
// throttling them would break heavy users without slowing any attacker
// (credential-stuffing actually happens at Keycloak's own login form,
// not against our session endpoint).
//
// The per-IP cap of 30 req/min/scope still applies to all auth-flow
// paths combined; callers wanting stricter scoping (per provider, per
// user-agent) extend rateLimit's `key` accordingly.
import type { NextRequest } from 'next/server';
import { handlers } from '@/auth';
import { clientIp, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

const RATE_LIMITED_SEGMENTS = new Set(['signin', 'callback', 'signout']);

const AUTH_RATE_LIMIT = {
  scope: 'auth.flow',
  max: 30, // req/min/IP across signin + callback + signout combined
  windowMs: 60_000,
} as const;

const isFlowPath = (pathname: string): boolean => {
  // pathname is `/api/auth/<segment>(/...)`
  const parts = pathname.split('/').filter(Boolean); // ['api','auth',<segment>,...]
  const segment = parts[2];
  return typeof segment === 'string' && RATE_LIMITED_SEGMENTS.has(segment);
};

const guard = async (req: NextRequest): Promise<Response | null> => {
  if (!isFlowPath(req.nextUrl.pathname)) return null;
  const result = await rateLimit({ key: clientIp(req), ...AUTH_RATE_LIMIT });
  return rateLimitResponse(result);
};

export const GET = async (req: NextRequest): Promise<Response> => {
  const blocked = await guard(req);
  if (blocked) return blocked;
  return handlers.GET(req);
};

export const POST = async (req: NextRequest): Promise<Response> => {
  const blocked = await guard(req);
  if (blocked) return blocked;
  return handlers.POST(req);
};
