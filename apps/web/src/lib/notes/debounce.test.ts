import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce.ts';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays the call until the input has settled', () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d('a');
    d('b');
    d('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('separates calls that arrive after the window closes', () => {
    const fn = vi.fn();
    const d = debounce(fn, 30);
    d('x');
    vi.advanceTimersByTime(40);
    d('y');
    vi.advanceTimersByTime(40);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'x');
    expect(fn).toHaveBeenNthCalledWith(2, 'y');
  });

  it('cancel() drops the pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 10);
    d('a');
    d.cancel();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const d = debounce(fn, 10);
    expect(() => d.cancel()).not.toThrow();
    d.cancel(); // second call also a no-op
    expect(fn).not.toHaveBeenCalled();
  });
});
