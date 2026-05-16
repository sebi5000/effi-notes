import type { ShareTtl } from '@/lib/api/schemas.ts';

const UNIT_MS: Record<ShareTtl['unit'], number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/** Converts an optional share TTL into an absolute expiry, or null ("forever"). */
export const ttlToExpiresAt = (ttl: ShareTtl | undefined): Date | null => {
  if (!ttl) return null;
  return new Date(Date.now() + ttl.value * UNIT_MS[ttl.unit]);
};
