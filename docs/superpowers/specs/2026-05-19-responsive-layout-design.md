# Responsive Layout — usable down to iPad Pro

**Date:** 2026-05-19
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` notes UI — `NotesShell`, `Sidebar`, `NoteEditor`,
`EditorToolbar`, `globals.css`, and two new layout hooks.

## Context

The notes UI has **no responsive behaviour** — there is not a single media
query in the app. Three fixed-width regions compete for horizontal space:

- **The sidebar** — a CSS grid column, resizable 380–720px (default 480px),
  or `0px` when collapsed (`NotesShell` inline `gridTemplateColumns`).
- **The A4 editor sheet** (`.a4-sheet`) — a *fixed* `210mm` (~794px). The
  fixed width is deliberate: on-screen layout maps 1:1 to the exported PDF,
  so on-screen line breaks are the PDF's line breaks.
- **The `DocumentPanel`** — a fixed 280px column right of the editor.

At iPad Pro width (1024px) a 480px sidebar plus a 794px sheet need 1274px —
they cannot both fit. Today the editor rail just `overflow-x`-scrolls, the
DocumentPanel overflows, and the floating `EditorToolbar` pill can run off
the edge. The app is not usable below roughly 1370px.

## Problem

The effi-notes UI must be **perfectly usable down to iPad Pro width
(1024px)** — both portrait (1024px) and landscape (1366px). Mobile is
explicitly out of scope (a separate app frontend later).

## Goals

1. The full notes UI is usable at any width from 1024px upward.
2. The A4 sheet's 1:1 on-screen-to-PDF mapping is preserved — the exported
   PDF is always true A4 regardless of on-screen size.
3. No layout regression above the breakpoints — wide-screen behaviour is
   unchanged.

## Non-goals

- Mobile / phone widths (< 1024px) — a separate app frontend later.
- Re-flowing the two-pane sidebar (folders + notes) into a stacked single
  column — the sidebar keeps its existing two-pane layout at its existing
  380px minimum.
- Touch-specific affordances (larger hit targets, swipe gestures, etc.).
- Any change to the editor, sharing, or folder features themselves.

## Decisions (resolved during brainstorming)

- **Sidebar at narrow widths: auto-collapse.** Below a breakpoint the
  sidebar auto-collapses, reusing the existing collapse mechanism. It stays
  toggleable with the `«`/`»` buttons. (Considered and rejected: an overlay
  drawer — more moving parts; "shrink & coexist" with a fluid editor — would
  drop the A4 1:1 mapping on narrow screens.)
- **A4 sheet when squeezed: scale to fit.** When the editor rail is narrower
  than the 794px sheet, the whole sheet scales down uniformly (CSS) so the
  entire page stays visible — like viewing a document at a lower zoom.
  Proportions, and therefore the 1:1 PDF mapping, are preserved.
  (Considered and rejected: horizontal scroll — you cannot see a full line
  of text without scrolling sideways.)
- **DocumentPanel auto-collapses** at narrow widths — it cannot coexist with
  the A4 sheet at 1024px.
- **Hybrid implementation.** CSS owns the declarative, stateless parts
  (`main` padding, the A4 scale, via media / container queries). A small
  `matchMedia` hook owns only the sidebar / doc-panel collapse state, which
  is already React state. (Considered and rejected: pure CSS — cannot own
  the JS-controlled sidebar grid column and toggle-override state; fully
  JS-driven — re-implements CSS natives in JS and adds resize re-render
  churn.)
- **No ADR** — this is additive, presentation-only responsive behaviour with
  no architectural change.

## Design

### 1. Responsive model & breakpoints

Two new hooks under `apps/web/src/lib/notes/`:

**`useMediaQuery(query: string): boolean`** — a generic `matchMedia` hook
built on `useSyncExternalStore` (SSR-safe, the same pattern as
`useSidebarWidth` / `useSidebarCollapsed`). It subscribes to the media
query list's `change` event. `getServerSnapshot` returns `false` (the
server assumes a wide viewport — matching the existing desktop default).

**`useResponsiveCollapse({ query, collapsed, toggle })`** — encapsulates the
"narrow auto-collapse layered over a persisted preference" pattern, so the
sidebar and the doc-panel share one implementation. Internally:

- `isNarrow = useMediaQuery(query)`.
- A transient `narrowCollapsed` state, default `true`.
- A render-phase reset: when `isNarrow` flips, `narrowCollapsed` is reset to
  `true` — the documented "adjusting state when a prop changes" React
  pattern, the same one `NotesShell` already uses for `dragWidth` /
  `wasCollapsed`. So re-entering narrow mode always starts collapsed.

It returns `{ collapsed, toggle, collapse, isNarrow }`:

- `collapsed` = `isNarrow ? narrowCollapsed : <persisted collapsed>`.
- `toggle` = flips the transient `narrowCollapsed` when narrow, otherwise
  calls the persisted `toggle`.
- `collapse` = forces collapsed (sets `narrowCollapsed = true`) when narrow,
  otherwise a no-op.

The persisted localStorage value (`useSidebarCollapsed` / `useDocPanel`) is
**never written** by a viewport change — so a user's explicit wide-screen
collapse choice survives a trip through a narrow viewport.

**Breakpoints** (plain values, used in both the matchMedia queries and the
CSS media queries — not tied to Tailwind's default scale):

| Region | Breakpoint | Rationale |
|--------|-----------|-----------|
| Sidebar | `< 1280px` → auto-collapse | Below this a default-width sidebar + A4 sheet stop fitting. |
| DocumentPanel | `< 1440px` → auto-collapse | Higher, so iPad Pro landscape (1366px) keeps the sidebar open **and** the A4 sheet at full size, the panel one tap away. |

### 2. Sidebar auto-collapse — `NotesShell.tsx`

- `NotesShell` calls `useResponsiveCollapse({ query: '(max-width: 1279px)',
  collapsed, toggle })`, wiring in the existing `useSidebarCollapsed` store.
  `effectiveCollapsed` and a narrow-aware `toggleSidebar` replace the direct
  use of `sidebarCollapsed` / `toggleSidebar`.
- **Grid column.** `gridTemplateColumns` becomes:
  - `effectiveCollapsed` → `0px 1fr`;
  - narrow & open → `${MIN_WIDTH}px 1fr` (a fixed 380px — the most room
    left for the editor while keeping the two-pane sidebar legible);
  - wide & open → `${effectiveWidth}px 1fr` (unchanged — persisted / dragged
    width).
- **Resize handle.** `SidebarResizeHandle` is rendered only when
  `!effectiveCollapsed && !isNarrow` — resizing is a wide-screen affordance;
  the narrow sidebar is a fixed 380px.
- **Toggle entry points.** Both the sidebar-header `«` (`onCollapse` prop)
  and the `»` expand button route through the narrow-aware `toggle`.
- **Auto-close on note open.** `openNote` calls `collapse()` after
  navigating, so picking a note at a narrow width returns the editor to full
  width. Selecting a *folder* only filters the notes list — the user stays
  in the sidebar to then pick a note — so `selectFolder` does **not** close
  it.
- **`main` padding.** `px-12 py-10` becomes `px-6 py-6 xl:px-12 xl:py-10`
  (Tailwind responsive variants — a CSS media query, no JS). `xl` (1280px)
  matches the sidebar breakpoint.

### 3. Editor — A4 scale-to-fit & DocPanel auto-collapse

**A4 scale-to-fit (`globals.css`, CSS only).** The editor rail
(`EditorContent`'s host) gets `container-type: inline-size`. `.a4-sheet`
gets, inside an `@media screen` block:

```css
zoom: min(1, 100cqw / 210mm);
```

`zoom` (unlike `transform: scale`) reflows layout — the scaled-down sheet
leaves no phantom horizontal scrollbar and no blank space below it. The
`min(1, …)` clamp means the sheet only ever scales *down*; at full width it
renders at exactly 210mm. `@media print` keeps `zoom: 1` and the full
`width: 210mm`, so the **exported PDF is always true A4** regardless of the
on-screen scale. The existing `overflow-x-auto` on `EditorContent` stays as
a harmless safety net.

**DocumentPanel auto-collapse (`NoteEditor.tsx`).** `CollaborativeEditor`
calls `useResponsiveCollapse({ query: '(max-width: 1439px)', collapsed:
!panelOpen, toggle: togglePanel })`, wiring in the existing `useDocPanel`
store (`useDocPanel` is open-oriented, so `collapsed` is `!panelOpen`). The
derived `effectivePanelOpen = !result.collapsed` drives the existing
`panelOpen ? <DocumentPanel/> : <button/>` branch, and the toggle routes
through the hook. Below 1440px the panel defaults collapsed — showing only
the thin (~28px) `»` re-open button — and stays toggleable.

### 4. EditorToolbar at narrow — `EditorToolbar.tsx`

The floating pill holds ~14 controls (~620px wide) and can marginally
overflow when the sidebar is force-opened at the narrowest widths. The pill
container gains `flex-wrap` + `max-w-full`, and `rounded-full` becomes
`rounded-3xl` so a wrapped two-row toolbar still reads as an intentional
shape. Pure CSS — no logic change; the toolbar still owns no state.

## Files

| File | Change |
|------|--------|
| `apps/web/src/lib/notes/use-media-query.ts` (+ test) | **new** — `matchMedia` hook |
| `apps/web/src/lib/notes/use-responsive-collapse.ts` (+ test) | **new** — narrow-collapse pattern hook |
| `apps/web/src/components/notes/NotesShell.tsx` | sidebar auto-collapse, grid width, resize-handle hide, auto-close on note open, responsive `main` padding |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | DocPanel auto-collapse |
| `apps/web/src/components/notes/Editor/EditorToolbar.tsx` | toolbar wrap |
| `apps/web/src/app/globals.css` | `.a4-sheet` container-query `zoom`; print reset |
| `vitest.config.ts` | coverage `include` for the two new hooks |

## Testing

`jsdom` does not implement `matchMedia`; tests stub `window.matchMedia` with
a controllable mock (matches flag + `change`-event dispatch).

- **`useMediaQuery`** — returns the initial match; updates when the mock
  media query list dispatches a `change` event; unsubscribes on unmount.
- **`useResponsiveCollapse`** — narrow defaults to collapsed; `toggle` flips
  the transient state when narrow and the persisted store when wide;
  `collapse` forces collapsed when narrow; re-entering narrow mode resets to
  collapsed; the persisted store is never written by a viewport change.
- **`NotesShell`** — auto-collapses the sidebar below 1280px; the resize
  handle is absent when narrow; opening a note while narrow auto-collapses
  the sidebar; selecting a folder while narrow does not; wide-screen
  behaviour (≥ 1280px) is unchanged.
- Existing `NotesShell` / editor tests stay green — the new behaviour is
  gated behind the `matchMedia` mock defaulting to "wide".

## Risks

- **`zoom` with `calc()` / `cqw`.** Well-supported in Safari (the iPad
  target) and in modern Chrome / Firefox (`zoom` was standardised in 2024).
  If it proves flaky in a real build, the fallback is a `ResizeObserver`
  measuring the rail into a `--a4-scale` custom property consumed by
  `zoom: var(--a4-scale)`. The plan verifies against a production build.
- **Resize re-render on viewport change.** `useMediaQuery` re-renders only
  on a breakpoint *crossing* (the `change` event fires per query match
  flip), not on every resize pixel — so there is no resize re-render storm.
- **`matchMedia` in tests.** Not implemented by `jsdom`; every test touching
  the new hooks must install the stub. Missing it surfaces as a clear
  `matchMedia is not a function` — not a silent wrong result.
