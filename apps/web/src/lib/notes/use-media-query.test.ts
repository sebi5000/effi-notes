// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMatchMedia, type MatchMediaController } from '@/test-matchmedia.ts';
import { useMediaQuery } from './use-media-query.ts';

afterEach(cleanup);

const QUERY = '(max-width: 1279px)';
let mm: MatchMediaController;

beforeEach(() => {
  mm = installMatchMedia();
});

describe('useMediaQuery', () => {
  it('returns false when the query does not match', () => {
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);
  });

  it('returns true when the query matches on mount', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(true);
  });

  it('updates when the media query match state changes', () => {
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);
    act(() => mm.set(QUERY, true));
    expect(result.current).toBe(true);
    act(() => mm.set(QUERY, false));
    expect(result.current).toBe(false);
  });
});
