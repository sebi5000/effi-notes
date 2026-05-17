# Sidebar Resize Handle

**Date:** 2026-05-17
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` notes UI (`NotesShell`, a new `useSidebarWidth` hook)

## Context

The notes sidebar is a fixed 480 px wide — `NotesShell`'s grid hard-codes
`grid-cols-[480px_1fr]` (expanded) / `grid-cols-[0px_1fr]` (collapsed). The
collapse state is user-controlled and persisted via the `useSidebarCollapsed`
hook (`useSyncExternalStore` + `localStorage`, SSR-safe, also bound to
Cmd/Ctrl+\). The width is not adjustable.

## Problem

Users cannot make the sidebar wider or narrower. Different screens and
different folder/note-name lengths want different sidebar widths; a fixed
480 px is a compromise that fits no one exactly.

## Goals

1. A draggable handle on the sidebar's right edge resizes the sidebar.
2. The chosen width persists across reloads.
3. The width is clamped to a usable range — a minimum wide enough to see both
   sidebar panes, a maximum that keeps the editor usable.
4. Resizing coexists with the existing collapse toggle.

## Decisions (resolved during brainstorming)

- **A pointer-drag handle**, hand-rolled (consistent with the repo's other
  hand-rolled interactions — folder/note DnD — no resize library).
- **Width persisted in `localStorage`** via a new `useSidebarWidth` hook that
  mirrors `useSidebarCollapsed` exactly (`useSyncExternalStore`, SSR-safe,
  custom same-tab change event). Key: `effi-notes:sidebar-width`.
- **Bounds: min 380 px, max 720 px, default 480 px.** 380 keeps the folder
  pane (200 px) and the notes pane both usable; 720 keeps the editor usable;
  480 is today's width, so existing users see no change until they drag.
- **The handle is `role="separator"`** with `aria-orientation="vertical"` and
  `aria-valuenow/valuemin/valuemax`, and supports ←/→ keyboard resize — a
  resize handle is a standard accessible control, unlike the drag-only
  folder/note DnD.
- **Double-clicking the handle resets to the 480 px default.**
- **No ADR** — a self-contained UI affordance, no architectural decision.

## Non-goals

- Resizing the inner folder-pane ↔ notes-pane split.
- A settings screen / numeric input for the width.
- Cross-device width sync (it is per-browser, like the collapse state).
- Any change to the collapse toggle or the Cmd/Ctrl+\ shortcut.

## Design

### 1. `useSidebarWidth` hook — `apps/web/src/lib/notes/use-sidebar-width.ts` (new)

A near-copy of `use-sidebar-collapsed.ts`'s structure:

- Module constants: `STORAGE_KEY = 'effi-notes:sidebar-width'`, a
  `CHANGE_EVENT` for same-tab notification, `MIN_WIDTH = 380`,
  `MAX_WIDTH = 720`, `DEFAULT_WIDTH = 480`.
- `clampWidth(n)` — clamps a number into `[MIN_WIDTH, MAX_WIDTH]`; a
  non-finite value falls back to `DEFAULT_WIDTH`.
- `getSnapshot()` — reads `localStorage`, parses, `clampWidth`s; returns
  `DEFAULT_WIDTH` when unset or unparseable.
- `getServerSnapshot()` — returns `DEFAULT_WIDTH` (SSR has no `localStorage`).
- `useSidebarWidth()` returns `readonly [width: number, setWidth: (n: number)
  => void]`. `width` comes from `useSyncExternalStore`. `setWidth` clamps,
  writes `localStorage`, and dispatches the same-tab `CHANGE_EVENT`.
- `MIN_WIDTH`/`MAX_WIDTH`/`DEFAULT_WIDTH` are exported so the handle can show
  them in its `aria-value*` attributes and the reset uses `DEFAULT_WIDTH`.

The `clampWidth` boundary logic is pure and unit-tested.

### 2. Resize handle in `NotesShell`

`apps/web/src/components/notes/NotesShell.tsx`:

- Call `const [sidebarWidth, setSidebarWidth] = useSidebarWidth();`.
- A transient drag state — `const [dragWidth, setDragWidth] = useState<number
  | null>(null)` — holds the live width while dragging so `localStorage` is
  not written on every frame. The width actually applied is
  `dragWidth ?? sidebarWidth`.
- The root grid's expanded column uses that width. Because the value is
  dynamic, the grid template is an **inline style** rather than a Tailwind
  class: `style={{ gridTemplateColumns: sidebarCollapsed ? '0px 1fr' :
  `${effectiveWidth}px 1fr` }}`. The `transition-[grid-template-columns]` is
  dropped while a drag is in progress (a transition would lag the pointer);
  keep it for the collapse animation.
- A **handle element** rendered inside the (relatively-positioned) grid root,
  shown only when not collapsed: a full-height ~6 px strip positioned at the
  sidebar/editor boundary (`left: ${effectiveWidth}px`), `cursor-col-resize`,
  a subtle hover/active highlight.
  - `onPointerDown`: `setPointerCapture`, record the start `clientX` and the
    start width, set `dragWidth` to the current width.
  - `onPointerMove` (while captured): `dragWidth = clampWidth(startWidth +
    (e.clientX - startX))`.
  - `onPointerUp` / `lostpointercapture`: `setSidebarWidth(dragWidth)` (commit
    + persist), then `setDragWidth(null)`.
  - `onDoubleClick`: `setSidebarWidth(DEFAULT_WIDTH)`.
  - `onKeyDown`: `ArrowLeft`/`ArrowRight` adjust the persisted width by a
    fixed step (e.g. 16 px), clamped — `setSidebarWidth(...)` directly (no
    drag state needed for keyboard).
  - Attributes: `role="separator"`, `aria-orientation="vertical"`,
    `aria-label` (i18n), `aria-valuenow={effectiveWidth}`,
    `aria-valuemin={MIN_WIDTH}`, `aria-valuemax={MAX_WIDTH}`, `tabIndex={0}`.

The `<Sidebar>` and its `<aside min-w-[480px]>` — the `min-w-[480px]` is
removed (the grid column now governs the width); the aside fills its grid
cell. The collapse toggle, the Cmd/Ctrl+\ shortcut, and `useSidebarCollapsed`
are untouched.

### 3. i18n

One new key in both `apps/web/messages/de.json` and `en.json`:
`notes.sidebar.resizeHandle` — the handle's `aria-label` (e.g. "Resize
sidebar" / "Seitenleiste anpassen").

## Files

| File | Change |
|------|--------|
| `apps/web/src/lib/notes/use-sidebar-width.ts` | **new** — persisted, clamped width hook |
| `apps/web/src/lib/notes/use-sidebar-width.test.ts` | **new** — `clampWidth` + hook tests |
| `apps/web/src/components/notes/NotesShell.tsx` | dynamic grid width; render the resize handle; drop the aside's static `min-w` reliance |
| `apps/web/src/components/notes/Sidebar/index.tsx` | drop `min-w-[480px]` from the `<aside>` (the grid cell governs width now) |
| `apps/web/messages/{de,en}.json` | `notes.sidebar.resizeHandle` key |
| `vitest.config.ts` | coverage `include` for the new hook if not glob-covered |

## Testing

- **`clampWidth`** — unit: clamps below `MIN_WIDTH` up, above `MAX_WIDTH`
  down, passes through an in-range value, maps a non-finite input to
  `DEFAULT_WIDTH`.
- **`useSidebarWidth`** — `setWidth` persists a clamped value to
  `localStorage`; `getSnapshot` reads it back clamped; an unset key yields
  `DEFAULT_WIDTH`.
- **`NotesShell`** — the resize handle renders with `role="separator"` when
  expanded and is absent when collapsed; an ArrowRight keypress on the handle
  widens the sidebar (the grid `gridTemplateColumns` reflects a larger
  width), ArrowLeft narrows it, and both stay within the bounds. (Pointer
  drag is exercised via `pointerdown`/`pointermove`/`pointerup` events with
  synthetic `clientX`.)

## Risks

- **`localStorage` write frequency.** Mitigated — the live drag uses a
  transient component state; `localStorage` is written once, on `pointerup`
  (and on each keyboard step / double-click reset).
- **Inline grid style vs. the collapse transition.** The collapse animation
  relies on `transition-[grid-template-columns]`; the transition is kept for
  collapse but suppressed during an active drag so the handle tracks the
  pointer 1:1. Documented in §2.
- **A stale persisted width outside the bounds** (e.g. bounds change in a
  future release) — `getSnapshot` always `clampWidth`s on read, so an
  out-of-range stored value self-heals.
