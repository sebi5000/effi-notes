// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidebarCollapsed } from './use-sidebar-collapsed.ts';

const KEY = 'effi-notes:sidebar-collapsed';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useSidebarCollapsed', () => {
  it('defaults to expanded (false) when nothing is stored', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);
  });

  it('reads a persisted collapsed state', () => {
    window.localStorage.setItem(KEY, 'true');
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(true);
  });

  it('toggle flips the value and persists it', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('true');
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe('false');
  });

  it('toggles on Cmd+\\ and Ctrl+\\', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', metaKey: true }));
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('ignores \\ without a modifier', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\' }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('treats a storage read failure as expanded (no crash)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);
  });

  it('does not throw when the storage write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(() => act(() => result.current[1]())).not.toThrow();
  });
});
