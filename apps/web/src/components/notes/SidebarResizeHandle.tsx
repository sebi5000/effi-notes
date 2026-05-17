'use client';

import { type PointerEvent as ReactPointerEvent, useRef } from 'react';

type Props = {
  /** Current effective sidebar width in px (controlled by the parent). */
  width: number;
  min: number;
  max: number;
  /** Width restored on a double-click. */
  defaultWidth: number;
  /** Accessible label for the separator. */
  label: string;
  /**
   * Width change. `committed` is false for live drag frames (the parent
   * shows them transiently) and true for the final value — pointer release,
   * a keyboard step, or the double-click reset.
   */
  onResize: (width: number, committed: boolean) => void;
};

const KEYBOARD_STEP = 16;

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(n)));

/**
 * Draggable vertical divider that resizes the sidebar. Hand-rolled HTML5
 * pointer events with pointer capture; also keyboard-resizable (←/→), and
 * a double-click resets to the default width.
 */
export function SidebarResizeHandle({ width, min, max, defaultWidth, label, onResize }: Props) {
  const drag = useRef<{ startX: number; startWidth: number; lastWidth: number } | null>(null);

  const widthAt = (e: ReactPointerEvent<HTMLDivElement>): number => {
    const d = drag.current;
    if (d === null) return width;
    return clamp(d.startWidth + (e.clientX - d.startX), min, max);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot receive pointer/keyboard events; a focusable <div role="separator"> is required for this interactive resize handle
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: width, lastWidth: width };
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        const next = widthAt(e);
        drag.current.lastWidth = next;
        onResize(next, false);
      }}
      onPointerUp={(e) => {
        if (drag.current === null) return;
        const next = widthAt(e);
        drag.current = null;
        onResize(next, true);
      }}
      onLostPointerCapture={() => {
        if (drag.current === null) return;
        const next = drag.current.lastWidth;
        drag.current = null;
        onResize(next, true);
      }}
      onDoubleClick={() => onResize(defaultWidth, true)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onResize(clamp(width - KEYBOARD_STEP, min, max), true);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onResize(clamp(width + KEYBOARD_STEP, min, max), true);
        }
      }}
      className="hover:bg-accent/40 focus:outline-none focus-visible:ring-accent absolute top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize transition-colors focus-visible:ring-2"
      style={{ left: `${width}px` }}
    />
  );
}
