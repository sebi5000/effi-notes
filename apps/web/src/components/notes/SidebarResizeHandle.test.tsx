// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarResizeHandle } from './SidebarResizeHandle.tsx';

afterEach(cleanup);

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const DEFAULT_PROPS: Omit<Parameters<typeof SidebarResizeHandle>[0], 'onResize'> = {
  width: 240,
  min: 160,
  max: 480,
  defaultWidth: 240,
  label: 'Resize sidebar',
};

const renderHandle = (props: Partial<typeof DEFAULT_PROPS> = {}) => {
  const onResize = vi.fn();
  const merged = { ...DEFAULT_PROPS, onResize, ...props };
  const { container } = render(<SidebarResizeHandle {...merged} />);
  const el = container.firstElementChild as HTMLElement;
  return { el, onResize };
};

describe('SidebarResizeHandle — ARIA attributes', () => {
  it('renders with role="separator"', () => {
    const { el } = renderHandle();
    expect(el.getAttribute('role')).toBe('separator');
  });

  it('renders with aria-orientation="vertical"', () => {
    const { el } = renderHandle();
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('renders with aria-valuenow equal to width', () => {
    const { el } = renderHandle({ width: 300 });
    expect(el.getAttribute('aria-valuenow')).toBe('300');
  });
});

describe('SidebarResizeHandle — keyboard interaction', () => {
  it('ArrowRight calls onResize with (width + 16, true)', () => {
    const { el, onResize } = renderHandle({ width: 240 });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith(256, true);
  });

  it('ArrowLeft calls onResize with (width - 16, true)', () => {
    const { el, onResize } = renderHandle({ width: 240 });
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(224, true);
  });

  it('ArrowRight near max clamps to max', () => {
    const { el, onResize } = renderHandle({ width: 480, max: 480 });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith(480, true);
  });

  it('ArrowLeft near min clamps to min', () => {
    const { el, onResize } = renderHandle({ width: 160, min: 160 });
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(160, true);
  });
});

describe('SidebarResizeHandle — pointer drag', () => {
  it('pointerMove after pointerDown calls onResize(_, false) with increased width', () => {
    const { el, onResize } = renderHandle({ width: 240 });
    fireEvent.pointerDown(el, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 300, pointerId: 1 });
    expect(onResize).toHaveBeenCalledWith(expect.any(Number), false);
    const [calledWidth] = onResize.mock.calls[0] as [number, boolean];
    expect(calledWidth).toBeGreaterThan(240);
  });

  it('pointerUp calls onResize(_, true)', () => {
    const { el, onResize } = renderHandle({ width: 240 });
    fireEvent.pointerDown(el, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 300, pointerId: 1 });
    const lastCall = onResize.mock.calls.at(-1) as [number, boolean];
    expect(lastCall[1]).toBe(true);
  });
});

describe('SidebarResizeHandle — double-click reset', () => {
  it('doubleClick calls onResize(defaultWidth, true)', () => {
    const { el, onResize } = renderHandle({ width: 300, defaultWidth: 240 });
    fireEvent.doubleClick(el);
    expect(onResize).toHaveBeenCalledWith(240, true);
  });
});
