import { getRedis } from '@app/jobs/connection';

/**
 * Redis-backed sliding-window rate limiter. Uses a single Redis SORTED SET
 * per key with timestamp scores; cheap (one round trip per check) and
 * shared across web instances when the app scales horizontally.
 *
 * Default targets `/api/auth/*` to throttle credential-stuffing attempts.
 * Customer projects extend by calling `rateLimit({ key, max, windowMs })`
 * from any route handler. The key is always namespaced so collisions
 * across consumers never leak across products forked from the template.
 */
type RateLimitOptions = {
  /** Stable identifier — typically `ip` or `userId`. */
  key: string;
  /** Logical bucket name, e.g. `auth.login`. */
  scope: string;
  /** Max calls allowed inside the rolling window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

type RateLimitResult = {
  ok: boolean;
  /** Remaining calls within the current window — 0 when blocked. */
  remaining: number;
  /** Seconds until the oldest entry leaves the window — surface in Retry-After. */
  resetSeconds: number;
};

const REDIS_PREFIX = 'rl';

export const rateLimit = async ({
  key,
  scope,
  max,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> => {
  const redis = getRedis();
  const now = Date.now();
  const cutoff = now - windowMs;
  const redisKey = `${REDIS_PREFIX}:${scope}:${key}`;

  // Pipeline: drop expired entries, count, add current entry, set TTL.
  // The current attempt is included in the count so the limit is `max`
  // not `max + 1`.
  const pipeline = redis.multi();
  pipeline.zremrangebyscore(redisKey, 0, cutoff);
  pipeline.zcard(redisKey);
  pipeline.zadd(redisKey, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
  pipeline.pexpire(redisKey, windowMs);
  const results = await pipeline.exec();

  const count = (results?.[1]?.[1] as number | null) ?? 0;
  const remaining = Math.max(0, max - count - 1);

  if (count >= max) {
    // Find oldest entry to compute reset time
    const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
    const oldestTs = oldest[1] ? Number(oldest[1]) : now;
    const resetSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
    return { ok: false, remaining: 0, resetSeconds };
  }

  return { ok: true, remaining, resetSeconds: Math.ceil(windowMs / 1000) };
};

/**
 * Best-effort client identifier for unauthenticated routes. Honours
 * X-Forwarded-For (set by Caddy when AUTH_TRUST_HOST=true) and falls
 * back to a constant — never undefined, so the limiter still works.
 */
export const clientIp = (req: Request): string => {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown';
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
};

/**
 * Convenience response with standard rate-limit headers. Returns null
 * if not blocked.
 */
export const rateLimitResponse = (result: RateLimitResult): Response | null => {
  if (result.ok) return null;
  return new Response('Too Many Requests', {
    status: 429,
    headers: {
      'Retry-After': String(result.resetSeconds),
      'X-RateLimit-Remaining': '0',
    },
  });
};
