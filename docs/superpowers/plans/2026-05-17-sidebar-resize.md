# Sidebar Resize Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable handle that resizes the notes sidebar, with the width clamped and persisted.

**Architecture:** A `useSidebarWidth` hook persists a clamped width in `localStorage` (mirroring the existing `useSidebarCollapsed`). A standalone `SidebarResizeHandle` component owns the pointer-drag / keyboard interaction. `NotesShell` drives its grid column from the width and renders the handle.

**Tech Stack:** Next.js 16, React 19, TypeScript 6 strict, Vitest + jsdom + @testing-library/react, TailwindCSS 4, next-intl.

**Spec:** `docs/superpowers/specs/2026-05-17-sidebar-resize-design.md`

**Conventions:** TDD where a task specifies a test. TypeScript strict (no `any` without `// reason:`). Conventional Commits. lefthook pre-commit MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root. `timeout` is unavailable on macOS. Commit directly to `main` (trunk-based, user-consented).

**Note:** the spec named the handle's i18n key `notes.sidebar.resizeHandle`; this plan places it at `notes.shell.resizeHandle` because `NotesShell` (which renders the handle) already uses the `notes.shell` translator — avoids a second `useTranslations` call. Functionally identical.

---

## Task 1: `useSidebarWidth` hook

**Files:**
- Create: `apps/web/src/lib/notes/use-sidebar-width.ts`
- Create: `apps/web/src/lib/notes/use-sidebar-width.test.ts`

- [ ] **Step 1: Write the failing test**

First read `apps/web/src/lib/notes/use-sidebar-collapsed.ts` and `use-sidebar-collapsed.test.ts` — the new hook and its test mirror them.

Create `apps/web/src/lib/notes/use-sidebar-width.test.ts`. Cover:
- `clampWidth` (pure): a value below `MIN_WIDTH` clamps up to `MIN_WIDTH`; above `MAX_WIDTH` clamps down to `MAX_WIDTH`; an in-range value passes through (rounded to an integer); `NaN`/`Infinity` → `DEFAULT_WIDTH`.
- `useSidebarWidth` (mirror the `use-sidebar-collapsed.test.ts` harness — `renderHook`, `localStorage` cleared in `beforeEach`): with no stored value the hook returns `DEFAULT_WIDTH`; calling `setWidth(600)` then re-reading returns `600`; calling `setWidth(99999)` persists and returns `MAX_WIDTH` (clamped).
Concrete `clampWidth` cases:
```ts
import { describe, expect, it } from 'vitest';
import { clampWidth, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from './use-sidebar-width.ts';

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/use-sidebar-width.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `apps/web/src/lib/notes/use-sidebar-width.ts`:
```ts
import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'effi-notes:sidebar-width';
/** Same-tab notification — the native `storage` event only fires cross-tab. */
const CHANGE_EVENT = 'effi-notes:sidebar-width-change';

export const MIN_WIDTH = 380;
export const MAX_WIDTH = 720;
export const DEFAULT_WIDTH = 480;

/** Clamp a width into [MIN_WIDTH, MAX_WIDTH]; a non-finite value → DEFAULT_WIDTH. */
export const clampWidth = (n: number): number => {
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
};

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

const getSnapshot = (): number => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_WIDTH;
    return clampWidth(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_WIDTH;
  }
};

/** The server has no localStorage — always render the default width there. */
const getServerSnapshot = (): number => DEFAULT_WIDTH;

/**
 * Sidebar width in px, persisted in localStorage so it survives reloads and
 * the per-route remount of NotesShell. `useSyncExternalStore` keeps it
 * SSR-safe. Returns `[width, setWidth]`; `setWidth` clamps before persisting.
 */
export const useSidebarWidth = (): readonly [number, (n: number) => void] => {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setWidth = useCallback((n: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clampWidth(n)));
    } catch {
      // localStorage unavailable (private mode / quota) — skip persistence
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [width, setWidth] as const;
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/use-sidebar-width.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/use-sidebar-width.ts apps/web/src/lib/notes/use-sidebar-width.test.ts
git commit -m "feat(notes): useSidebarWidth — persisted, clamped sidebar width"
```

---

## Task 2: `SidebarResizeHandle` component

**Files:**
- Create: `apps/web/src/components/notes/SidebarResizeHandle.tsx`
- Create: `apps/web/src/components/notes/SidebarResizeHandle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/SidebarResizeHandle.test.tsx` (jsdom + `@testing-library/react`; this component takes no i18n, so no message provider is needed). `SidebarResizeHandle`'s props are `{ width, min, max, defaultWidth, label, onResize }` (exact types in Step 3). Cover:
- renders an element with `role="separator"`, `aria-orientation="vertical"`, and `aria-valuenow` equal to `width`;
- `ArrowRight` `keyDown` calls `onResize` with `(width + 16, true)`; `ArrowLeft` with `(width - 16, true)`;
- `ArrowRight` near the max clamps — with `width = max`, the call value is `max` (not above);
- a pointer drag: `pointerDown` then `pointerMove` with a larger `clientX` calls `onResize(_, false)` with an increased width, and `pointerUp` calls `onResize(_, true)`;
- `doubleClick` calls `onResize(defaultWidth, true)`.
For pointer events use `fireEvent.pointerDown/pointerMove/pointerUp` with `{ clientX, pointerId: 1 }`. jsdom does not implement `setPointerCapture` — add `HTMLElement.prototype.setPointerCapture = vi.fn()` (and `releasePointerCapture`) in the test setup, or guard the call (see Step 3).

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/SidebarResizeHandle.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/notes/SidebarResizeHandle.tsx`:
```tsx
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
export function SidebarResizeHandle({
  width,
  min,
  max,
  defaultWidth,
  label,
  onResize,
}: Props) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const widthAt = (e: ReactPointerEvent<HTMLDivElement>): number => {
    const d = drag.current;
    if (d === null) return width;
    return clamp(d.startWidth + (e.clientX - d.startX), min, max);
  };

  return (
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
        drag.current = { startX: e.clientX, startWidth: width };
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        onResize(widthAt(e), false);
      }}
      onPointerUp={(e) => {
        if (drag.current === null) return;
        const next = widthAt(e);
        drag.current = null;
        onResize(next, true);
      }}
      onLostPointerCapture={() => {
        if (drag.current === null) return;
        drag.current = null;
        onResize(width, true);
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
      className="hover:bg-accent/40 focus-visible:bg-accent/40 absolute top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize transition-colors focus:outline-none"
      style={{ left: `${width}px` }}
    />
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/SidebarResizeHandle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/SidebarResizeHandle.tsx apps/web/src/components/notes/SidebarResizeHandle.test.tsx
git commit -m "feat(notes): SidebarResizeHandle drag/keyboard component"
```

---

## Task 3: Wire the handle into `NotesShell`

**Files:**
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/messages/de.json`, `apps/web/messages/en.json`

- [ ] **Step 1: Add the i18n key**

Add `resizeHandle` to the `notes.shell` namespace in BOTH `apps/web/messages/de.json` and `apps/web/messages/en.json`: English `"Resize sidebar"`, German `"Seitenleiste anpassen"`. (Confirm `notes.shell` is the namespace `NotesShell` uses — it reads `t('expandSidebar')` etc.; place the new key there. Both files must keep matching keys.)

- [ ] **Step 2: Wire `NotesShell`**

In `apps/web/src/components/notes/NotesShell.tsx`:
- Add imports:
  ```ts
  import { useState } from 'react'; // ensure useState is imported
  import { SidebarResizeHandle } from './SidebarResizeHandle.tsx';
  import {
    DEFAULT_WIDTH,
    MAX_WIDTH,
    MIN_WIDTH,
    useSidebarWidth,
  } from '@/lib/notes/use-sidebar-width.ts';
  ```
- In the component body, near the existing `useSidebarCollapsed()` call:
  ```ts
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const effectiveWidth = dragWidth ?? sidebarWidth;
  ```
- The root grid `<div>` currently is
  `className={\`grid h-screen transition-[grid-template-columns] duration-200 ${sidebarCollapsed ? 'grid-cols-[0px_1fr]' : 'grid-cols-[480px_1fr]'}\`}`.
  Replace it with a `relative` grid whose columns come from an inline style, and whose transition is suppressed mid-drag:
  ```tsx
  <div
    className={`relative grid h-screen ${
      dragWidth === null ? 'transition-[grid-template-columns] duration-200' : ''
    }`}
    style={{
      gridTemplateColumns: sidebarCollapsed ? '0px 1fr' : `${effectiveWidth}px 1fr`,
    }}
  >
  ```
- Render the handle between the sidebar cell `<div className="overflow-hidden">…</div>` and the `<main>` element, only when not collapsed:
  ```tsx
  {sidebarCollapsed ? null : (
    <SidebarResizeHandle
      width={effectiveWidth}
      min={MIN_WIDTH}
      max={MAX_WIDTH}
      defaultWidth={DEFAULT_WIDTH}
      label={t('resizeHandle')}
      onResize={(w, committed) => {
        if (committed) {
          setDragWidth(null);
          setSidebarWidth(w);
        } else {
          setDragWidth(w);
        }
      }}
    />
  )}
  ```
  (`t` is the existing `useTranslations('notes.shell')` in this component.)

- [ ] **Step 3: Drop the sidebar's fixed min-width**

In `apps/web/src/components/notes/Sidebar/index.tsx`, the `<aside>` element has `min-w-[480px]` in its `className` — remove just that class. The grid column now governs the sidebar width; the `<aside>` fills its cell.

- [ ] **Step 4: Verify**

Run: `bun run typecheck`
Expected: PASS (all 8 packages). Fix any prop fallout.
Run: `bun run vitest run apps/web/src/components/notes apps/web/src/lib/notes`
Expected: PASS — the new hook + handle tests and all pre-existing component tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/NotesShell.tsx apps/web/src/components/notes/Sidebar/index.tsx apps/web/messages
git commit -m "feat(notes): resizable sidebar wired into NotesShell"
```

---

## Task 4: Full verification

**Files:** `vitest.config.ts` only if a coverage gap is found.

- [ ] **Step 1: Full test suite**

Run: `bun run vitest run`
Expected: all test files pass. `use-sidebar-width.ts` and `SidebarResizeHandle.tsx` are covered by the existing `apps/web/src/lib/notes/**/*.ts` / `apps/web/src/components/notes/**/*.tsx` coverage globs — no `vitest.config.ts` change is expected. If the coverage gate fails for a genuinely-uncovered new file, add it to `include` and re-run.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 3: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. Catches Turbopack-only compile errors `vitest`/`tsc` miss. If it fails, fix the reported file and re-run Steps 1–3.

- [ ] **Step 4: Commit (only if a coverage-config change was needed)**

```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for the sidebar resize handle"
```
Otherwise nothing to commit.

---

## Self-Review

**Spec coverage:**
- Draggable resize handle → Task 2 (`SidebarResizeHandle`) + Task 3 (rendered in `NotesShell`).
- Persisted width, clamped → Task 1 (`useSidebarWidth` + `clampWidth`).
- Min 380 / max 720 / default 480 → Task 1 constants (`MIN_WIDTH`/`MAX_WIDTH`/`DEFAULT_WIDTH`).
- `role="separator"`, `aria-value*`, ←/→ keyboard, double-click reset → Task 2.
- Dynamic grid column, transition suppressed mid-drag, handle hidden when collapsed → Task 3 Step 2.
- Drop the `<aside>` static `min-w` → Task 3 Step 3.
- Live drag uses transient state, persists once on commit → Task 2 `onResize(_, false|true)` + Task 3's `onResize` handler.
- i18n key → Task 3 Step 1 (placed at `notes.shell.resizeHandle`; see the header note).
- Turbopack verification → Task 4.

**Placeholder scan:** No "TBD"/"implement later". Tasks 1 and 2 give full implementations; Task 3 gives the exact grid markup and the handler.

**Type consistency:** `MIN_WIDTH`/`MAX_WIDTH`/`DEFAULT_WIDTH`/`clampWidth`/`useSidebarWidth` are defined in Task 1 and imported unchanged in Tasks 2 (test) and 3. `SidebarResizeHandle`'s prop type `{ width, min, max, defaultWidth, label, onResize }` is defined in Task 2 and supplied with exactly those props in Task 3. `onResize: (width: number, committed: boolean) => void` has the same signature at the Task 2 definition and the Task 3 call site.
