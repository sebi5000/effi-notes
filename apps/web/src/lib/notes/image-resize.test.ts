import { describe, expect, it } from 'vitest';
import { clampImageWidth, MIN_IMAGE_WIDTH } from './image-resize.ts';

describe('clampImageWidth', () => {
  it('passes a width that fits through unchanged (rounded)', () => {
    expect(clampImageWidth(300.4, 600)).toBe(300);
  });
  it('clamps to the available width', () => {
    expect(clampImageWidth(900, 600)).toBe(600);
  });
  it('clamps up to the minimum width', () => {
    expect(clampImageWidth(10, 600)).toBe(MIN_IMAGE_WIDTH);
  });
  it('falls back to the available width for a non-finite input', () => {
    expect(clampImageWidth(Number.NaN, 600)).toBe(600);
  });
  it('never returns less than the minimum even when available is tiny', () => {
    expect(clampImageWidth(20, 10)).toBe(MIN_IMAGE_WIDTH);
  });
});
