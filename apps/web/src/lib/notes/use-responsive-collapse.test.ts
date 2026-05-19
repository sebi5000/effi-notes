// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia, type MatchMediaController } from '@/test-matchmedia.ts';
import { useResponsiveCollapse } from './use-responsive-collapse.ts';

afterEach(cleanup);

const QUERY = '(max-width: 1279px)';
let mm: MatchMediaController;

beforeEach(() => {
  mm = installMatchMedia();
});

describe('useResponsiveCollapse', () => {
  it('passes the persisted expanded state through when wide', () => {
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    expect(result.current.isNarrow).toBe(false);
    expect(result.current.collapsed).toBe(false);
  });

  it('passes the persisted collapsed state through when wide', () => {
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: true, toggle: vi.fn() }),
    );
    expect(result.current.collapsed).toBe(true);
  });

  it('auto-collapses when narrow, ignoring a persisted expanded state', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    expect(result.current.isNarrow).toBe(true);
    expect(result.current.collapsed).toBe(true);
  });

  it('toggle flips the persisted store when wide', () => {
    const toggle = vi.fn();
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle }),
    );
    act(() => result.current.toggle());
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('toggle flips the transient state when narrow, never the persisted store', () => {
    mm.set(QUERY, true);
    const toggle = vi.fn();
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle }),
    );
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('resets to collapsed each time the viewport re-enters narrow mode', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    act(() => result.current.toggle()); // open while narrow
    expect(result.current.collapsed).toBe(false);
    act(() => mm.set(QUERY, false)); // go wide
    act(() => mm.set(QUERY, true)); // back to narrow
    expect(result.current.collapsed).toBe(true);
  });

  it('collapse() forces collapsed when narrow', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    act(() => result.current.toggle()); // open
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.collapse());
    expect(result.current.collapsed).toBe(true);
  });
});
