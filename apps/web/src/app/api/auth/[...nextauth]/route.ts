// Catch-all auth.js endpoint: callbacks, sign-in / sign-out, CSRF token,
// session JSON. Rate-limited per source IP to throttle credential-stuffing
// attempts. The handler chain: rate-limit → auth.js → response.

import type { NextRequest } from 'next/server';
import { handlers } from '@/auth';
import { clientIp, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

const AUTH_RATE_LIMIT = {
  scope: 'auth.endpoint',
  max: 30, // requests per window per IP
  windowMs: 60_000, // 1 minute
} as const;

const guard = async (req: NextRequest): Promise<Response | null> => {
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
