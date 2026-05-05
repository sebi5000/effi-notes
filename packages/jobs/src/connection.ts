import { env } from '@app/config/env';
import { Redis, type RedisOptions } from 'ioredis';

/**
 * Lazily-instantiated Redis connection for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
 * — without these, blocking queue commands abort and the worker dies on
 * brief Redis hiccups. Both are non-negotiable; see ADR 0018.
 */
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

let cached: Redis | undefined;

export const getRedis = (): Redis => {
  if (cached) return cached;
  cached = new Redis(env.REDIS_URL, baseOptions);
  return cached;
};

/** For consumers that need a separately-managed connection (e.g. Bull Board). */
export const createRedis = (): Redis => new Redis(env.REDIS_URL, baseOptions);

/** Graceful shutdown — call from worker SIGTERM handlers. */
export const closeRedis = async (): Promise<void> => {
  if (cached) {
    await cached.quit();
    cached = undefined;
  }
};
