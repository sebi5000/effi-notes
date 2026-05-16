// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDocPanel } from './use-doc-panel.ts';

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

describe('useDocPanel', () => {
  it('defaults to open', () => {
    const { result } = renderHook(() => useDocPanel());
    expect(result.current[0]).toBe(true);
  });

  it('toggles closed and persists to localStorage', () => {
    const { result } = renderHook(() => useDocPanel());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem('effi-notes:doc-panel-open')).toBe('false');
  });

  it('reads a persisted closed state on mount', () => {
    window.localStorage.setItem('effi-notes:doc-panel-open', 'false');
    const { result } = renderHook(() => useDocPanel());
    expect(result.current[0]).toBe(false);
  });
});
