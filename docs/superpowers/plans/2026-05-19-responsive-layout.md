# Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the effi-notes UI usable from 1024px (iPad Pro) upward — an auto-collapsing sidebar, an A4 editor sheet that scales to fit, and an auto-collapsing document panel.

**Architecture:** Hybrid CSS + JS. A tiny `matchMedia` hook (`useMediaQuery`) and a pattern hook (`useResponsiveCollapse`) drive the sidebar and document-panel collapse state — both are already React state. CSS owns the stateless parts: the A4 sheet scales down via a container query, `main` padding shrinks via a Tailwind responsive variant. No localStorage preference is ever overwritten by a viewport change.

**Tech Stack:** Next.js 16 / React 19, TypeScript 6 strict, TailwindCSS 4, Vitest + `@testing-library/react` (jsdom), Biome.

**Source spec:** `docs/superpowers/specs/2026-05-19-responsive-layout-design.md`

---

## Prerequisites — worktree setup

This plan is executed in an isolated git worktree. A fresh worktree is missing
gitignored files. Before any typecheck / build / test, run from the worktree root:

```bash
bun install
bun --filter @app/db generate
cp <main-repo>/.env.local .env.local
ln -s ../../.env.local apps/web/.env.local
```

Then confirm a clean baseline: `bun run test` (the suite is green on `main`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/web/src/test-matchmedia.ts` | **new** — test helper: a controllable `window.matchMedia` stub for jsdom. Not production code. |
| `apps/web/src/lib/notes/use-media-query.ts` | **new** — `useMediaQuery(query)`: subscribes to a CSS media query, returns whether it matches. |
| `apps/web/src/lib/notes/use-responsive-collapse.ts` | **new** — `useResponsiveCollapse(...)`: layers a viewport-driven auto-collapse over a persisted collapse preference. |
| `apps/web/src/lib/notes/breakpoints.ts` | **new** — the two `matchMedia` query-string constants. |
| `apps/web/src/components/notes/NotesShell.tsx` | **modify** — sidebar auto-collapse, grid column width, resize-handle hiding, auto-close on note open, responsive `main` padding. |
| `apps/web/src/components/notes/NotesShell.test.tsx` | **modify** — install the `matchMedia` stub; add responsive-sidebar tests. |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | **modify** — `editor-rail` container class; document-panel auto-collapse. |
| `apps/web/src/components/notes/Editor/EditorToolbar.tsx` | **modify** — let the toolbar pill wrap on narrow viewports. |
| `apps/web/src/app/globals.css` | **modify** — `editor-rail` container; A4 `zoom` scale rule. |
| `vitest.config.ts` | **modify** — exclude the `matchMedia` test helper from coverage. |

**Note on coverage:** the two new hooks live under `apps/web/src/lib/notes/`, which the
existing coverage `include` glob (`apps/web/src/lib/notes/**/*.ts`) already covers — no
`include` change is needed. Only the test helper needs an `exclude` entry (Task 6).

---

## Task 1: `useMediaQuery` hook + `matchMedia` test helper

**Files:**
- Create: `apps/web/src/test-matchmedia.ts`
- Create: `apps/web/src/lib/notes/use-media-query.ts`
- Test: `apps/web/src/lib/notes/use-media-query.test.ts`

jsdom does not implement `window.matchMedia`. Any hook that calls it throws
`matchMedia is not a function` in tests, so we build a controllable stub first.

- [ ] **Step 1: Create the `matchMedia` test helper**

Create `apps/web/src/test-matchmedia.ts`:

```ts
/**
 * Controllable `window.matchMedia` stub for jsdom tests.
 *
 * jsdom does not implement `matchMedia`; any component or hook that calls it
 * throws `matchMedia is not a function`. `installMatchMedia` installs a stub
 * where every query starts non-matching (a wide viewport); tests flip a
 * query's match state — emitting a `change` event — via the returned
 * controller.
 *
 * Call it in `beforeEach`. vitest rebuilds the jsdom environment per test
 * file, so no explicit uninstall is needed.
 */

type ChangeListener = () => void;

type QueryState = {
  matches: boolean;
  listeners: Set<ChangeListener>;
};

export type MatchMediaController = {
  /** Set whether `query` matches now; notifies subscribed listeners. */
  set: (query: string, matches: boolean) => void;
};

export const installMatchMedia = (): MatchMediaController => {
  const states = new Map<string, QueryState>();

  const stateFor = (query: string): QueryState => {
    const existing = states.get(query);
    if (existing !== undefined) return existing;
    const created: QueryState = { matches: false, listeners: new Set() };
    states.set(query, created);
    return created;
  };

  const matchMedia = (query: string): MediaQueryList => {
    const state = stateFor(query);
    return {
      media: query,
      get matches() {
        return state.matches;
      },
      addEventListener: (_type: string, cb: ChangeListener) => {
        state.listeners.add(cb);
      },
      removeEventListener: (_type: string, cb: ChangeListener) => {
        state.listeners.delete(cb);
      },
    } as unknown as MediaQueryList;
  };

  Object.defineProperty(window, 'matchMedia', {
    value: matchMedia,
    writable: true,
    configurable: true,
  });

  return {
    set: (query: string, matches: boolean) => {
      const state = stateFor(query);
      state.matches = matches;
      for (const cb of state.listeners) cb();
    },
  };
};
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/notes/use-media-query.test.ts`:

```ts
// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMatchMedia, type MatchMediaController } from '@/test-matchmedia.ts';
import { useMediaQuery } from './use-media-query.ts';

afterEach(cleanup);

const QUERY = '(max-width: 1279px)';
let mm: MatchMediaController;

beforeEach(() => {
  mm = installMatchMedia();
});

describe('useMediaQuery', () => {
  it('returns false when the query does not match', () => {
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);
  });

  it('returns true when the query matches on mount', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(true);
  });

  it('updates when the media query match state changes', () => {
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);
    act(() => mm.set(QUERY, true));
    expect(result.current).toBe(true);
    act(() => mm.set(QUERY, false));
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/use-media-query.test.ts`
Expected: FAIL — `Cannot find module './use-media-query.ts'`.

- [ ] **Step 4: Implement `useMediaQuery`**

Create `apps/web/src/lib/notes/use-media-query.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * Built on `useSyncExternalStore` so it is SSR-safe (no hydration mismatch)
 * and re-renders only when the match state flips — not on every resize pixel.
 * The server has no `matchMedia`, so the server snapshot is always `false`
 * (a wide viewport — the app's desktop default).
 */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = (): boolean => window.matchMedia(query).matches;
  const getServerSnapshot = (): boolean => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/use-media-query.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/test-matchmedia.ts apps/web/src/lib/notes/use-media-query.ts apps/web/src/lib/notes/use-media-query.test.ts
git commit -m "$(cat <<'EOF'
feat(notes): useMediaQuery hook + matchMedia test helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `useResponsiveCollapse` hook

**Files:**
- Create: `apps/web/src/lib/notes/use-responsive-collapse.ts`
- Test: `apps/web/src/lib/notes/use-responsive-collapse.test.ts`

This hook layers a viewport-driven auto-collapse over a persisted collapse
preference, so the sidebar and the document panel share one implementation.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/use-responsive-collapse.test.ts`:

```ts
// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia, type MatchMediaController } from '@/test-matchmedia.ts';
import { useResponsiveCollapse } from './use-responsive-collapse.ts';

afterEach(cleanup);

const QUERY = '(max-width: 1279px)';
let mm: MatchMediaController;

beforeEach(() => {
  mm = installMatchMedia();
});

describe('useResponsiveCollapse', () => {
  it('passes the persisted expanded state through when wide', () => {
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    expect(result.current.isNarrow).toBe(false);
    expect(result.current.collapsed).toBe(false);
  });

  it('passes the persisted collapsed state through when wide', () => {
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: true, toggle: vi.fn() }),
    );
    expect(result.current.collapsed).toBe(true);
  });

  it('auto-collapses when narrow, ignoring a persisted expanded state', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    expect(result.current.isNarrow).toBe(true);
    expect(result.current.collapsed).toBe(true);
  });

  it('toggle flips the persisted store when wide', () => {
    const toggle = vi.fn();
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle }),
    );
    act(() => result.current.toggle());
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('toggle flips the transient state when narrow, never the persisted store', () => {
    mm.set(QUERY, true);
    const toggle = vi.fn();
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle }),
    );
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('resets to collapsed each time the viewport re-enters narrow mode', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    act(() => result.current.toggle()); // open while narrow
    expect(result.current.collapsed).toBe(false);
    act(() => mm.set(QUERY, false)); // go wide
    act(() => mm.set(QUERY, true)); // back to narrow
    expect(result.current.collapsed).toBe(true);
  });

  it('collapse() forces collapsed when narrow', () => {
    mm.set(QUERY, true);
    const { result } = renderHook(() =>
      useResponsiveCollapse({ query: QUERY, collapsed: false, toggle: vi.fn() }),
    );
    act(() => result.current.toggle()); // open
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.collapse());
    expect(result.current.collapsed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/use-responsive-collapse.test.ts`
Expected: FAIL — `Cannot find module './use-responsive-collapse.ts'`.

- [ ] **Step 3: Implement `useResponsiveCollapse`**

Create `apps/web/src/lib/notes/use-responsive-collapse.ts`:

```ts
import { useCallback, useState } from 'react';
import { useMediaQuery } from './use-media-query.ts';

type Args = {
  /** Match means "narrow viewport" — e.g. '(max-width: 1279px)'. */
  query: string;
  /** The persisted collapsed state — meaningful at wide widths. */
  collapsed: boolean;
  /** Toggles the persisted collapsed state. */
  toggle: () => void;
};

type Result = {
  /** Effective collapsed state — auto-collapsed while narrow. */
  collapsed: boolean;
  /** Toggle: the transient narrow state when narrow, the persisted store when wide. */
  toggle: () => void;
  /** Forces collapsed while narrow; a no-op (harmless) when wide. */
  collapse: () => void;
  /** Whether the viewport currently matches the narrow query. */
  isNarrow: boolean;
};

/**
 * Layers a viewport-driven auto-collapse over a persisted collapse preference.
 *
 * At wide widths the persisted `collapsed` / `toggle` pass straight through.
 * At narrow widths a transient state takes over: it defaults to collapsed and
 * resets to collapsed every time the viewport re-enters narrow mode, so the
 * persisted preference is never written by a viewport change.
 */
export const useResponsiveCollapse = ({ query, collapsed, toggle }: Args): Result => {
  const isNarrow = useMediaQuery(query);
  const [narrowCollapsed, setNarrowCollapsed] = useState(true);

  // Reset the transient state to "collapsed" whenever the viewport re-enters
  // narrow mode — React's documented "adjust state when a prop changes"
  // pattern, the same one NotesShell uses for dragWidth. Guarded so it
  // converges.
  const [wasNarrow, setWasNarrow] = useState(isNarrow);
  if (isNarrow !== wasNarrow) {
    setWasNarrow(isNarrow);
    if (isNarrow) setNarrowCollapsed(true);
  }

  const narrowToggle = useCallback(() => {
    setNarrowCollapsed((c) => !c);
  }, []);

  const collapse = useCallback(() => {
    setNarrowCollapsed(true);
  }, []);

  return {
    collapsed: isNarrow ? narrowCollapsed : collapsed,
    toggle: isNarrow ? narrowToggle : toggle,
    collapse,
    isNarrow,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/use-responsive-collapse.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/use-responsive-collapse.ts apps/web/src/lib/notes/use-responsive-collapse.test.ts
git commit -m "$(cat <<'EOF'
feat(notes): useResponsiveCollapse hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `breakpoints.ts` + NotesShell sidebar auto-collapse

**Files:**
- Create: `apps/web/src/lib/notes/breakpoints.ts`
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Test: `apps/web/src/components/notes/NotesShell.test.tsx`

- [ ] **Step 1: Create the breakpoints module**

Create `apps/web/src/lib/notes/breakpoints.ts`:

```ts
/**
 * Viewport breakpoints for the responsive notes layout, as `matchMedia`
 * query strings. Below each width the corresponding region auto-collapses
 * (see `useResponsiveCollapse`).
 *
 * `main` padding has its own breakpoint in CSS — Tailwind's `xl` (1280px),
 * which coincides with the sidebar breakpoint below.
 */

/** Below 1280px the sidebar auto-collapses. */
export const SIDEBAR_NARROW_QUERY = '(max-width: 1279px)';

/** Below 1440px the editor's document panel auto-collapses. */
export const DOC_PANEL_NARROW_QUERY = '(max-width: 1439px)';
```

- [ ] **Step 2: Write the failing tests — install the stub + add the responsive describe block**

In `apps/web/src/components/notes/NotesShell.test.tsx`:

**2a.** Add two imports. The import block currently ends:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_WIDTH, MIN_WIDTH } from '@/lib/notes/use-sidebar-width.ts';
```

Replace those two lines with (alphabetical order — Biome enforces it):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIDEBAR_NARROW_QUERY } from '@/lib/notes/breakpoints.ts';
import { MAX_WIDTH, MIN_WIDTH } from '@/lib/notes/use-sidebar-width.ts';
import { installMatchMedia, type MatchMediaController } from '@/test-matchmedia.ts';
```

**2b.** Find the localStorage-key constants:

```ts
const SIDEBAR_WIDTH_KEY = 'effi-notes:sidebar-width';
const SIDEBAR_COLLAPSED_KEY = 'effi-notes:sidebar-collapsed';
```

Add directly below them:

```ts
let mm: MatchMediaController;
```

**2c.** In the `beforeEach`, add `installMatchMedia` as the first statement. Change:

```ts
beforeEach(() => {
  localStorage.removeItem(SIDEBAR_WIDTH_KEY);
```

to:

```ts
beforeEach(() => {
  mm = installMatchMedia();
  localStorage.removeItem(SIDEBAR_WIDTH_KEY);
```

**2d.** Append this new `describe` block at the end of the file:

```tsx
describe('NotesShell — responsive sidebar (narrow viewport)', () => {
  const firstCol = (grid: HTMLElement): string =>
    grid.style.gridTemplateColumns.split(' ')[0] ?? '';

  it('auto-collapses the sidebar below 1280px', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(firstCol(grid)).toBe('0px');
  });

  it('does not render the resize handle when narrow', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(grid.querySelector('[role="separator"]')).toBeNull();
  });

  it('opens the narrow sidebar to a fixed MIN_WIDTH column', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const { container, getByRole } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    fireEvent.click(getByRole('button', { name: 'Expand sidebar' }));
    expect(firstCol(grid)).toBe(`${MIN_WIDTH}px`);
  });

  it('auto-collapses the sidebar when a note is opened while narrow', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const note = {
      id: 'n1',
      title: 'Quarterly Review',
      snippet: '',
      folderId: null,
      authorId: 'u1',
      archivedAt: null,
      updatedAt: '2025-01-01T00:00:00.000Z',
      tags: [],
      shareCount: 0,
    };
    const { container, getByRole, getByText } = render(
      wrap(<NotesShell {...defaultProps} initialNotes={[note]} />),
    );
    const grid = within(container).getByTestId('notes-shell-grid');
    fireEvent.click(getByRole('button', { name: 'Expand sidebar' }));
    expect(firstCol(grid)).toBe(`${MIN_WIDTH}px`);
    fireEvent.click(getByText('Quarterly Review'));
    expect(firstCol(grid)).toBe('0px');
  });

  it('keeps the sidebar open when a folder is selected while narrow', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const folder = {
      id: 'f1',
      name: 'Engineering',
      parentId: null,
      icon: 'folder',
      position: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      shareCount: 0,
    };
    const { container, getByRole, getByText } = render(
      wrap(<NotesShell {...defaultProps} folders={[folder]} />),
    );
    const grid = within(container).getByTestId('notes-shell-grid');
    fireEvent.click(getByRole('button', { name: 'Expand sidebar' }));
    fireEvent.click(getByText('Engineering'));
    expect(firstCol(grid)).toBe(`${MIN_WIDTH}px`);
  });

  it('stays expanded above 1280px (wide default)', () => {
    // installMatchMedia defaults every query to non-matching → wide viewport.
    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(grid.querySelector('[role="separator"]')).not.toBeNull();
    expect(firstCol(grid)).not.toBe('0px');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run vitest run apps/web/src/components/notes/NotesShell.test.tsx`
Expected: FAIL — the new tests fail (`gridTemplateColumns` first column is the
wide `480px`, not `0px` — NotesShell does not react to the media query yet).
The pre-existing tests should already pass (the stub just supplies `matchMedia`).

- [ ] **Step 4: Wire the responsive sidebar into NotesShell**

In `apps/web/src/components/notes/NotesShell.tsx`, make six edits.

**4a — imports.** After the line:

```ts
import { foldersApi, notesApi, sharesApi, tagsApi } from '@/lib/notes/api-client.ts';
```

add:

```ts
import { SIDEBAR_NARROW_QUERY } from '@/lib/notes/breakpoints.ts';
```

And after the line:

```ts
import { tagColor } from '@/lib/notes/tag-color.ts';
```

add:

```ts
import { useResponsiveCollapse } from '@/lib/notes/use-responsive-collapse.ts';
```

**4b — hook usage.** Replace:

```tsx
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
```

with:

```tsx
  const [persistedCollapsed, togglePersistedCollapsed] = useSidebarCollapsed();
  const {
    collapsed: sidebarCollapsed,
    toggle: toggleSidebar,
    collapse: collapseSidebar,
    isNarrow,
  } = useResponsiveCollapse({
    query: SIDEBAR_NARROW_QUERY,
    collapsed: persistedCollapsed,
    toggle: togglePersistedCollapsed,
  });
```

(`sidebarCollapsed` and `toggleSidebar` keep their names — every other use of
them in the component is unchanged.)

**4c — grid column width.** Replace:

```tsx
      style={{
        gridTemplateColumns: sidebarCollapsed ? '0px 1fr' : `${effectiveWidth}px 1fr`,
      }}
```

with:

```tsx
      style={{
        gridTemplateColumns: sidebarCollapsed
          ? '0px 1fr'
          : isNarrow
            ? `${MIN_WIDTH}px 1fr`
            : `${effectiveWidth}px 1fr`,
      }}
```

**4d — hide the resize handle when narrow.** Replace:

```tsx
      {sidebarCollapsed ? null : (
        <SidebarResizeHandle
```

with:

```tsx
      {sidebarCollapsed || isNarrow ? null : (
        <SidebarResizeHandle
```

**4e — auto-close the sidebar on note open.** In the `openNote` callback, replace:

```tsx
  const openNote = useCallback(
    async (id: string) => {
      router.push(`/notes/${id}${qSuffix(query)}`);
      markShareSeen(notes.find((n) => n.id === id)?.sharedWithMe);
      try {
        const detail = await notesApi.get(id);
        setNoteDetail(detail);
      } catch {
        // ignore — the destination page re-fetches server-side
      }
    },
    [router, query, notes, markShareSeen],
  );
```

with:

```tsx
  const openNote = useCallback(
    async (id: string) => {
      router.push(`/notes/${id}${qSuffix(query)}`);
      markShareSeen(notes.find((n) => n.id === id)?.sharedWithMe);
      collapseSidebar();
      try {
        const detail = await notesApi.get(id);
        setNoteDetail(detail);
      } catch {
        // ignore — the destination page re-fetches server-side
      }
    },
    [router, query, notes, markShareSeen, collapseSidebar],
  );
```

**4f — responsive `main` padding.** Replace:

```tsx
      <main className="relative flex flex-col px-12 py-10">
```

with:

```tsx
      <main className="relative flex flex-col px-6 py-6 xl:px-12 xl:py-10">
```

- [ ] **Step 5: Run the NotesShell tests to verify they pass**

Run: `bun run vitest run apps/web/src/components/notes/NotesShell.test.tsx`
Expected: PASS — all tests (the 9 pre-existing + 6 new responsive tests).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/notes/breakpoints.ts apps/web/src/components/notes/NotesShell.tsx apps/web/src/components/notes/NotesShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(notes): auto-collapse the sidebar below 1280px

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Editor — A4 scale-to-fit + document-panel auto-collapse

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`

`NoteEditor.tsx` has no Vitest unit test (the editor is covered by Phase E E2E,
per `vitest.config.ts`). This task is verified by typecheck + a production build.

- [ ] **Step 1: Add the container + A4 scale rule to globals.css**

In `apps/web/src/app/globals.css`, find the block:

```css
.a4-sheet.prose-paper {
  /* fill the printable column exactly — no extra max-width clamp */
  max-width: none;
}
```

Add directly below it:

```css

/* The editor rail is a size container so the A4 sheet can scale to fit it
 * (see the `@media screen` rule below). */
.editor-rail {
  container-type: inline-size;
}

/* On screen, scale the A4 sheet DOWN (never up) so the whole page fits the
 * editor rail with no horizontal scrolling. `zoom` reflows layout — unlike
 * `transform: scale` — so the shrunk sheet leaves no phantom scrollbar and no
 * blank strip beside it. Excluded from print: the exported PDF stays a true
 * 210mm A4 regardless of the on-screen scale. */
@media screen {
  .a4-sheet {
    zoom: min(1, 100cqw / 210mm);
  }
}
```

- [ ] **Step 2: Add the `editor-rail` class to the editor content host**

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`, replace:

```tsx
        <EditorContent editor={editor} className="flex-1 overflow-x-auto pb-24" />
```

with:

```tsx
        <EditorContent editor={editor} className="editor-rail flex-1 overflow-x-auto pb-24" />
```

- [ ] **Step 3: Wire the document panel through `useResponsiveCollapse`**

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`:

**3a — imports.** After the line:

```ts
import { nextAutoTitle } from '@/lib/notes/auto-title.ts';
```

add:

```ts
import { DOC_PANEL_NARROW_QUERY } from '@/lib/notes/breakpoints.ts';
```

And after the line:

```ts
import { useDocPanel } from '@/lib/notes/use-doc-panel.ts';
```

add:

```ts
import { useResponsiveCollapse } from '@/lib/notes/use-responsive-collapse.ts';
```

**3b — hook usage.** In the `CollaborativeEditor` function, replace:

```tsx
  const [panelOpen, togglePanel] = useDocPanel();
```

with:

```tsx
  const [persistedPanelOpen, togglePersistedPanel] = useDocPanel();
  const { collapsed: panelCollapsed, toggle: togglePanel } = useResponsiveCollapse({
    query: DOC_PANEL_NARROW_QUERY,
    collapsed: !persistedPanelOpen,
    toggle: togglePersistedPanel,
  });
  const panelOpen = !panelCollapsed;
```

(`panelOpen` and `togglePanel` keep their names — the `panelOpen ? … : …`
branch and the toggle wiring below are unchanged.)

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `bun run test`
Expected: PASS — the whole suite (the editor is not unit-tested; this confirms
nothing else broke).

- [ ] **Step 6: Production build — confirm the CSS compiles**

Run: `bun --filter @app/web build`
Expected: build succeeds. Confirm the build does not error on the `zoom` /
`min()` / `cqw` CSS. (If the CSS pipeline rejects it, fall back to the
spec-documented `ResizeObserver` + `--a4-scale` mechanism and re-verify.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/notes/Editor/NoteEditor.tsx
git commit -m "$(cat <<'EOF'
feat(notes): scale the A4 sheet to fit + auto-collapse the doc panel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: EditorToolbar — wrap on narrow viewports

**Files:**
- Modify: `apps/web/src/components/notes/Editor/EditorToolbar.tsx`

The floating toolbar pill (~14 controls, ~620px) can marginally overflow the
editor rail when the sidebar is force-opened at the narrowest widths. This is
a purely presentational CSS change — `EditorToolbar` owns no state and its
interaction tests are unaffected; no new unit test is warranted.

- [ ] **Step 1: Let the toolbar pill wrap**

In `apps/web/src/components/notes/Editor/EditorToolbar.tsx`, replace the pill's
`className` line:

```tsx
        className="border-paper-line/80 bg-background/95 pointer-events-auto inline-flex items-center gap-0.5 rounded-full border px-2 py-1 shadow-lg backdrop-blur"
```

with:

```tsx
        className="border-paper-line/80 bg-background/95 pointer-events-auto inline-flex max-w-full flex-wrap items-center justify-center gap-0.5 gap-y-1 rounded-3xl border px-2 py-1 shadow-lg backdrop-blur"
```

(`max-w-full` + `flex-wrap` let the pill wrap to a second row instead of
overflowing; `rounded-3xl` keeps a wrapped two-row pill looking intentional;
`justify-center` centres a wrapped row.)

- [ ] **Step 2: Run the EditorToolbar tests to confirm no regression**

Run: `bun run vitest run apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`
Expected: PASS — unchanged (the change is cosmetic).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/notes/Editor/EditorToolbar.tsx
git commit -m "$(cat <<'EOF'
fix(notes): let the editor toolbar wrap on narrow viewports

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Coverage tidy-up + full verification

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Exclude the `matchMedia` test helper from coverage**

In `vitest.config.ts`, find the `coverage.exclude` array entry:

```ts
        'apps/web/src/lib/api/test-session.ts',
        'apps/worker/src/processors/sample-pdf.fixture.ts',
```

Replace it with:

```ts
        'apps/web/src/lib/api/test-session.ts',
        'apps/web/src/test-matchmedia.ts',
        'apps/worker/src/processors/sample-pdf.fixture.ts',
```

(The two new hooks need no `include` change — `apps/web/src/lib/notes/**/*.ts`
already covers them. Only the test helper needs excluding, matching the
existing `test-session.ts` precedent.)

- [ ] **Step 2: Run the full test suite**

Run: `bun run test`
Expected: PASS — the entire suite.

- [ ] **Step 3: Run coverage and confirm thresholds hold**

Run: `bun run vitest run --coverage`
Expected: PASS — coverage thresholds (90% statements/lines/functions, 80%
branches) still met.

- [ ] **Step 4: Typecheck the whole workspace**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Lint**

Run: `bun run lint && bun run lint:next`
Expected: no errors.

- [ ] **Step 6: Production build**

Run: `bun run build`
Expected: build succeeds for `@app/web` and `@app/worker`.

- [ ] **Step 7: Manual QA note**

The responsive behaviour (the A4 `zoom` scale, the toolbar wrap, the
auto-collapse animations) is best confirmed visually in a browser at 1024px,
1280px and 1366px widths. The automated gates above do not exercise rendered
pixels — flag this for a human visual check before merge.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts
git commit -m "$(cat <<'EOF'
test(notes): exclude the matchMedia test helper from coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** Every spec section maps to a task — the model & breakpoints
(Tasks 1–3: `useMediaQuery`, `useResponsiveCollapse`, `breakpoints.ts`); sidebar
auto-collapse (Task 3); A4 scale-to-fit + DocPanel auto-collapse (Task 4);
EditorToolbar wrap (Task 5); testing & coverage (every task + Task 6).

**Spec deviation (intentional):** the spec's Files table says `vitest.config.ts`
gains a coverage `include` for the new hooks. The hooks live under
`apps/web/src/lib/notes/`, already covered by the existing `lib/notes/**/*.ts`
glob — so no `include` change is needed. The real config change is *excluding*
the test helper (`test-matchmedia.ts`). Task 6 does the correct thing.

**Placeholders:** none — every code step contains complete code; every command
has an expected result.

**Type consistency:** `useResponsiveCollapse` returns `{ collapsed, toggle,
collapse, isNarrow }` (Task 2) — consumed with exactly those names in NotesShell
(Task 3) and NoteEditor (Task 4). `installMatchMedia` / `MatchMediaController`
(Task 1) are imported with those names in every test. `SIDEBAR_NARROW_QUERY` /
`DOC_PANEL_NARROW_QUERY` (Task 3) match their import sites.
