// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareView } from '@/lib/api/schemas.ts';
import { useShares } from './useShares.ts';

afterEach(cleanup);

const scope = { kind: 'note' as const, id: 'n1' };

const makeShare = (id: string): ShareView => ({
  id,
  grantee: { id: 'u1', displayName: 'Alice', email: 'alice@example.com' },
  access: 'VIEW',
  expiresAt: null,
  status: 'active',
  createdById: 'u0',
  createdAt: '2026-05-16T00:00:00.000Z',
});

/** Build a fetch stub that responds based on method+url. */
const makeFetcher = (
  responses: Array<{ method?: string; urlContains?: string; body: unknown; status?: number }>,
) => {
  const calls: Array<{ url: string; method: string }> = [];
  let idx = 0;
  const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method });
    const res = responses[idx] ?? responses[responses.length - 1];
    idx++;
    return new Response(JSON.stringify(res?.body ?? {}), {
      status: res?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
};

describe('useShares', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads shares on mount and sets loading=false when done', async () => {
    const { fetcher } = makeFetcher([{ body: { shares: [makeShare('s1')] } }]);
    const { result } = renderHook(() => useShares(scope, fetcher));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shares).toHaveLength(1);
    expect(result.current.shares[0]?.id).toBe('s1');
    expect(result.current.error).toBeNull();
  });

  it('create posts and then reloads the list', async () => {
    const share = makeShare('s2');
    const { fetcher } = makeFetcher([
      // initial load
      { body: { shares: [] } },
      // POST create
      { body: share, status: 201 },
      // reload after create
      { body: { shares: [share] } },
    ]);
    const { result } = renderHook(() => useShares(scope, fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ granteeId: 'u1', access: 'VIEW' });
    });

    expect(result.current.shares).toHaveLength(1);
    expect(result.current.shares[0]?.id).toBe('s2');
  });

  it('revoke deletes and then reloads the list', async () => {
    const share = makeShare('s3');
    const { fetcher } = makeFetcher([
      // initial load
      { body: { shares: [share] } },
      // DELETE
      { body: { revoked: true } },
      // reload after revoke
      { body: { shares: [] } },
    ]);
    const { result } = renderHook(() => useShares(scope, fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shares).toHaveLength(1);

    await act(async () => {
      await result.current.revoke('s3');
    });

    expect(result.current.shares).toHaveLength(0);
  });

  it('sets error when the API returns a non-2xx response', async () => {
    const { fetcher } = makeFetcher([{ body: { error: 'not found' }, status: 404 }]);
    const { result } = renderHook(() => useShares(scope, fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not found');
    expect(result.current.shares).toHaveLength(0);
  });

  it('reload refreshes the list', async () => {
    const share = makeShare('s4');
    const { fetcher } = makeFetcher([{ body: { shares: [] } }, { body: { shares: [share] } }]);
    const { result } = renderHook(() => useShares(scope, fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shares).toHaveLength(0);

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.shares).toHaveLength(1);
    expect(result.current.shares[0]?.id).toBe('s4');
  });
});
