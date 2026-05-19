// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PublicLinkView } from '@/lib/api/schemas.ts';
import { usePublicLink } from './usePublicLink.ts';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LINK: PublicLinkView = {
  id: 'pl-1',
  token: 'tok',
  url: '/p/tok',
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

/** Fetcher whose GET returns `initialLink`, POST returns LINK, DELETE revokes. */
const buildFetcher = (initialLink: PublicLinkView | null): typeof fetch =>
  vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method?.toUpperCase() ?? 'GET';
    if (method === 'POST') return json(LINK, 201);
    if (method === 'DELETE') return json({ revoked: true });
    return json({ link: initialLink });
  }) as unknown as typeof fetch;

describe('usePublicLink', () => {
  it('loads the current link on mount', async () => {
    // The fetcher must be stable across renders — a fresh one each render
    // would re-trigger the load effect on loop.
    const fetcher = buildFetcher(LINK);
    const { result } = renderHook(() => usePublicLink('note-1', fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.link?.token).toBe('tok');
  });

  it('generate() creates a link and exposes it', async () => {
    const fetcher = buildFetcher(null);
    const { result } = renderHook(() => usePublicLink('note-1', fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.link).toBeNull();

    await act(async () => {
      await result.current.generate();
    });
    expect(result.current.link?.url).toBe('/p/tok');
  });

  it('revoke() clears the link', async () => {
    const fetcher = buildFetcher(LINK);
    const { result } = renderHook(() => usePublicLink('note-1', fetcher));
    await waitFor(() => expect(result.current.link?.token).toBe('tok'));

    await act(async () => {
      await result.current.revoke();
    });
    expect(result.current.link).toBeNull();
  });
});
