// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCopyToClipboard } from './use-copy-to-clipboard.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('useCopyToClipboard', () => {
  it('sets copied on success and clears it after the reset delay', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyToClipboard(2000));

    await act(async () => {
      await result.current.copy('http://x/notes/1');
    });
    expect(writeText).toHaveBeenCalledWith('http://x/notes/1');
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });

  it('stays not-copied when the clipboard write rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('x');
    });
    expect(result.current.copied).toBe(false);
  });
});
