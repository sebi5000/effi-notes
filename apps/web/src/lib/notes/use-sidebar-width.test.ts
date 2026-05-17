// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampWidth,
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  useSidebarWidth,
} from './use-sidebar-width.ts';

const KEY = 'effi-notes:sidebar-width';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('clampWidth', () => {
  it('clamps below the minimum up', () => {
    expect(clampWidth(MIN_WIDTH - 100)).toBe(MIN_WIDTH);
  });

  it('clamps above the maximum down', () => {
    expect(clampWidth(MAX_WIDTH + 100)).toBe(MAX_WIDTH);
  });

  it('passes an in-range value through, rounded', () => {
    expect(clampWidth(512.6)).toBe(513);
  });

  it('maps a non-finite value to the default', () => {
    expect(clampWidth(Number.NaN)).toBe(DEFAULT_WIDTH);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WIDTH);
  });
});

describe('useSidebarWidth', () => {
  it('defaults to DEFAULT_WIDTH when nothing is stored', () => {
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current[0]).toBe(DEFAULT_WIDTH);
  });

  it('reads a persisted width', () => {
    window.localStorage.setItem(KEY, '600');
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current[0]).toBe(600);
  });

  it('setWidth persists a valid value and reflects it', () => {
    const { result } = renderHook(() => useSidebarWidth());
    act(() => result.current[1](600));
    expect(result.current[0]).toBe(600);
    expect(window.localStorage.getItem(KEY)).toBe('600');
  });

  it('setWidth clamps an out-of-range value before persisting', () => {
    const { result } = renderHook(() => useSidebarWidth());
    act(() => result.current[1](99999));
    expect(result.current[0]).toBe(MAX_WIDTH);
    expect(window.localStorage.getItem(KEY)).toBe(String(MAX_WIDTH));
  });

  it('treats a storage read failure as DEFAULT_WIDTH (no crash)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current[0]).toBe(DEFAULT_WIDTH);
  });

  it('does not throw when the storage write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useSidebarWidth());
    expect(() => act(() => result.current[1](500))).not.toThrow();
    expect(result.current[0]).toBe(DEFAULT_WIDTH);
  });
});
