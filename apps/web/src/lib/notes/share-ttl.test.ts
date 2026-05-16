import { describe, expect, it } from 'vitest';
import { ttlToExpiresAt } from './share-ttl.ts';

describe('ttlToExpiresAt', () => {
  it('returns null when no ttl is given', () => {
    expect(ttlToExpiresAt(undefined)).toBeNull();
  });

  it('computes a future date for each unit', () => {
    const now = Date.now();
    const mins = ttlToExpiresAt({ value: 30, unit: 'minutes' });
    const hours = ttlToExpiresAt({ value: 2, unit: 'hours' });
    const days = ttlToExpiresAt({ value: 1, unit: 'days' });
    expect(mins?.getTime()).toBeGreaterThanOrEqual(now + 30 * 60_000 - 50);
    expect(hours?.getTime()).toBeGreaterThanOrEqual(now + 2 * 3_600_000 - 50);
    expect(days?.getTime()).toBeGreaterThanOrEqual(now + 86_400_000 - 50);
  });
});
