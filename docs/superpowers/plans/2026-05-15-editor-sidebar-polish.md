# Editor & Sidebar Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five polish items on the notes UI — remove the duplicate native search clear button, drop the editor focus frame, unify the editor font, add a collapsible sidebar, and add a copy-as-Markdown button.

**Architecture:** Three are pure CSS / class changes. The collapsible sidebar is a persisted, SSR-safe `useSyncExternalStore` hook driving a grid-column transition in `NotesShell`. Copy-as-Markdown is a pure `turndown`-based HTML→Markdown helper plus a small button component — fully isolated from the Tiptap extension list, the Collaboration document, and the save path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, TailwindCSS 4, Tiptap 3, next-intl, Vitest + Testing Library, Bun. New deps: `turndown`, `turndown-plugin-gfm`.

**Spec:** `docs/superpowers/specs/2026-05-15-editor-sidebar-polish-design.md`

**Conventions:**
- Run a single test file with `bun run test <path>` (forwards to `vitest run <path>`; pure/component tests need no database).
- Conventional Commits; pre-commit hooks (lefthook: biome, eslint-next, repo-wide typecheck) are mandatory — fix causes, never `--no-verify`.
- TypeScript strict, no `any`. Every user-visible string goes through next-intl; `en.json` and `de.json` must stay key-aligned.
- `react-hooks/set-state-in-effect` is an ESLint **error** in this repo: never call a `setState` synchronously inside a `useEffect` body.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `apps/web/src/app/globals.css` | hide native search `×`; suppress `.ProseMirror` focus outline; editor headings → body font | 1 |
| `apps/web/src/components/notes/NotesShell.tsx` | note title → body font; use the collapse hook; collapsed grid + expand button | 1, 3 |
| `apps/web/src/lib/notes/use-sidebar-collapsed.ts` | **new** — persisted, keyboard-toggled sidebar-collapse state hook | 2 |
| `apps/web/src/lib/notes/use-sidebar-collapsed.test.ts` | **new** — hook tests | 2 |
| `apps/web/src/components/notes/Sidebar/index.tsx` | collapse button in the sidebar header (`onCollapse` prop) | 3 |
| `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx` | test for the collapse button | 3 |
| `apps/web/src/lib/notes/markdown.ts` | **new** — pure `htmlToMarkdown(html)` via `turndown` + GFM plugin | 4 |
| `apps/web/src/lib/notes/markdown.test.ts` | **new** — converter tests | 4 |
| `apps/web/src/types/turndown-plugin-gfm.d.ts` | **new** — ambient types for the untyped `turndown-plugin-gfm` | 4 |
| `apps/web/package.json` | add `turndown`, `turndown-plugin-gfm`, `@types/turndown` | 4 |
| `apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx` | **new** — subtle copy button with copied-feedback | 5 |
| `apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx` | **new** — button tests | 5 |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | mount `CopyMarkdownButton` in the editor top bar | 5 |
| `apps/web/messages/en.json`, `de.json` | strings: collapse/expand sidebar, copy-markdown | 3, 5 |
| `vitest.config.ts` | add `CopyMarkdownButton.tsx` to the coverage `include` list | 5 |

---

## Task 1: Styling fixes — search `×`, editor focus ring, editor font

Three CSS changes plus one className change. No automated test (CSS); verified by typecheck + lint + a described visual check.

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/notes/NotesShell.tsx:184`

- [ ] **Step 1: Editor headings → body font**

In `apps/web/src/app/globals.css`, find the rule:

```css
.prose-paper :where(h1, h2, h3, h4) {
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--color-foreground);
  margin-top: 1.4em;
  margin-bottom: 0.4em;
  line-height: 1.25;
}
```

Change the first declaration `font-family: var(--font-display);` to:

```css
  font-family: var(--font-body);
```

(Leave weight, colour, margins, line-height unchanged.)

- [ ] **Step 2: Suppress the editor focus outline + hide the native search clear button**

Append to the end of `apps/web/src/app/globals.css`:

```css
/* The editor's editable surface is a large content area — the global
 * :focus-visible ring would frame the whole A4 sheet. Suppress it there;
 * every other control keeps the ring. */
.ProseMirror:focus,
.ProseMirror:focus-visible {
  outline: none;
}

/* The command bar uses type="search"; hide the browser's native clear
 * control so only the themed × button shows. */
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
}
```

- [ ] **Step 3: Note title → body font**

In `apps/web/src/components/notes/NotesShell.tsx`, the note title `<h1>` (around line 184) currently reads:

```tsx
            <h1 className="font-display text-foreground mb-4 text-3xl font-semibold">
              {noteDetail.title}
            </h1>
```

Change `font-display` to `font-body`:

```tsx
            <h1 className="font-body text-foreground mb-4 text-3xl font-semibold">
              {noteDetail.title}
            </h1>
```

Leave the empty-state `<h2 className="font-display …">{t('welcome')}</h2>` unchanged — it is app chrome, not editor content.

- [ ] **Step 4: Verify typecheck + lint**

Run: `bun run typecheck`
Expected: PASS — all packages exit 0.

Run: `bun run lint`
Expected: PASS — Biome lints the CSS and TS; no errors.

- [ ] **Step 5: Visual check**

With the dev server running (`bun run dev`), signed in, open a note and confirm:
1. The search bar shows only the themed `×` (no second native clear icon) once text is typed.
2. Clicking into the editor produces no outline/frame around the A4 sheet; the caret still shows focus. Buttons/inputs/the folder tree still show their focus ring on keyboard focus.
3. Editor headings and body text, and the note title above the editor, all render in the same sans-serif font (Inter).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/notes/NotesShell.tsx
git commit -m "fix(notes): unify editor font, drop editor focus ring + native search x"
```

---

## Task 2: `useSidebarCollapsed` hook

A persisted, SSR-safe, keyboard-toggled hook for the sidebar collapse state. Lives under `lib/notes/**`, which is coverage-gated (≥90 % statements/functions/lines, ≥80 % branches).

**Files:**
- Create: `apps/web/src/lib/notes/use-sidebar-collapsed.ts`
- Test: `apps/web/src/lib/notes/use-sidebar-collapsed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/use-sidebar-collapsed.test.ts`:

```ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidebarCollapsed } from './use-sidebar-collapsed.ts';

const KEY = 'effi-notes:sidebar-collapsed';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useSidebarCollapsed', () => {
  it('defaults to expanded (false) when nothing is stored', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);
  });

  it('reads a persisted collapsed state', () => {
    window.localStorage.setItem(KEY, 'true');
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(true);
  });

  it('toggle flips the value and persists it', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('true');
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe('false');
  });

  it('toggles on Cmd+\\ and Ctrl+\\', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', metaKey: true }));
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('ignores \\ without a modifier', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\' }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('treats a storage read failure as expanded (no crash)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);
  });

  it('does not throw when the storage write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(() => act(() => result.current[1]())).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test apps/web/src/lib/notes/use-sidebar-collapsed.test.ts`
Expected: FAIL — `./use-sidebar-collapsed.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `apps/web/src/lib/notes/use-sidebar-collapsed.ts`:

```ts
import { useCallback, useEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'effi-notes:sidebar-collapsed';
/** Same-tab notification — the native `storage` event only fires cross-tab. */
const CHANGE_EVENT = 'effi-notes:sidebar-collapsed-change';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

const getSnapshot = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

/** The server has no localStorage — always render expanded there. */
const getServerSnapshot = (): boolean => false;

/**
 * Sidebar collapsed state, persisted in localStorage so it survives reloads
 * and the per-route remount of NotesShell. `useSyncExternalStore` keeps it
 * SSR-safe (no hydration mismatch) without a setState-in-effect. Also
 * toggled by Cmd/Ctrl+\.
 *
 * Returns `[collapsed, toggle]`.
 */
export const useSidebarCollapsed = (): readonly [boolean, () => void] => {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable (private mode / quota) — skip persistence
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return [collapsed, toggle] as const;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test apps/web/src/lib/notes/use-sidebar-collapsed.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/use-sidebar-collapsed.ts apps/web/src/lib/notes/use-sidebar-collapsed.test.ts
git commit -m "feat(notes): useSidebarCollapsed hook (persisted, keyboard-toggled)"
```

---

## Task 3: Collapsible sidebar UI

Wire the hook into `NotesShell` (collapsed grid + expand button) and add a collapse button to the `Sidebar` header. Adds the i18n strings. `NotesShell.tsx` and `Sidebar/index.tsx` are not coverage-gated; the gate for this task's logic is Task 2's hook test, plus one `Sidebar` component test.

**Files:**
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

- [ ] **Step 1: Add the i18n strings**

In `apps/web/messages/en.json`, replace the `notes.shell` block:

```json
    "shell": {
      "welcome": "Pick a note from the sidebar",
      "emptyHint": "Or hit ⌘K to search across every note in the workspace."
    },
```

with:

```json
    "shell": {
      "welcome": "Pick a note from the sidebar",
      "emptyHint": "Or hit ⌘K to search across every note in the workspace.",
      "expandSidebar": "Expand sidebar"
    },
```

and replace the `notes.sidebar` block:

```json
    "sidebar": {
      "foldersHeading": "Folders",
      "tagsHeading": "Tags",
      "notesHeading": "Notes",
      "emptyState": "No notes here yet.",
      "loading": "Loading…"
    },
```

with:

```json
    "sidebar": {
      "foldersHeading": "Folders",
      "tagsHeading": "Tags",
      "notesHeading": "Notes",
      "emptyState": "No notes here yet.",
      "loading": "Loading…",
      "collapseSidebar": "Collapse sidebar"
    },
```

In `apps/web/messages/de.json`, replace the `notes.shell` block:

```json
    "shell": {
      "welcome": "Wählen Sie eine Notiz in der Seitenleiste",
      "emptyHint": "Oder drücken Sie ⌘K, um alle Notizen im Workspace zu durchsuchen."
    },
```

with:

```json
    "shell": {
      "welcome": "Wählen Sie eine Notiz in der Seitenleiste",
      "emptyHint": "Oder drücken Sie ⌘K, um alle Notizen im Workspace zu durchsuchen.",
      "expandSidebar": "Seitenleiste ausklappen"
    },
```

and replace the `notes.sidebar` block:

```json
    "sidebar": {
      "foldersHeading": "Ordner",
      "tagsHeading": "Tags",
      "notesHeading": "Notizen",
      "emptyState": "Hier gibt es noch keine Notizen.",
      "loading": "Wird geladen…"
    },
```

with:

```json
    "sidebar": {
      "foldersHeading": "Ordner",
      "tagsHeading": "Tags",
      "notesHeading": "Notizen",
      "emptyState": "Hier gibt es noch keine Notizen.",
      "loading": "Wird geladen…",
      "collapseSidebar": "Seitenleiste einklappen"
    },
```

- [ ] **Step 2: Add the collapse button to `Sidebar`**

In `apps/web/src/components/notes/Sidebar/index.tsx`:

Add `onCollapse` to the `Props` type — change:

```ts
  folderMutations?: FolderMutationHandlers & {
    onCreate: (name: string, parentId: string | null) => Promise<void>;
  };
};
```

to:

```ts
  folderMutations?: FolderMutationHandlers & {
    onCreate: (name: string, parentId: string | null) => Promise<void>;
  };
  /** When provided, a collapse button is shown in the sidebar header. */
  onCollapse?: () => void;
};
```

Add `onCollapse` to the destructured parameters — change:

```ts
  onQueryChange,
  onSelectFolder,
  onSelectNote,
  folderMutations,
}: Props) {
```

to:

```ts
  onQueryChange,
  onSelectFolder,
  onSelectNote,
  folderMutations,
  onCollapse,
}: Props) {
```

Replace the `<header>` block:

```tsx
      <header className="flex items-center gap-2">
        <span className="font-display text-foreground text-lg font-semibold tracking-tight">
          effi · notes
        </span>
      </header>
```

with:

```tsx
      <header className="flex items-center gap-2">
        <span className="font-display text-foreground text-lg font-semibold tracking-tight">
          effi · notes
        </span>
        {onCollapse ? (
          <button
            type="button"
            aria-label={t('collapseSidebar')}
            title={t('collapseSidebar')}
            onClick={onCollapse}
            className="text-muted-foreground/60 hover:text-foreground ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-sm leading-none"
          >
            «
          </button>
        ) : null}
      </header>
```

(`t` is already `useTranslations('notes.sidebar')` in this component.)

- [ ] **Step 3: Wire the collapse state into `NotesShell`**

In `apps/web/src/components/notes/NotesShell.tsx`:

Add the hook import after the existing `@/lib/notes/folder-tree.ts` import:

```tsx
import { useSidebarCollapsed } from '@/lib/notes/use-sidebar-collapsed.ts';
```

Inside the component, after `const t = useTranslations('notes.shell');`, add:

```tsx
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
```

Replace the entire returned JSX — currently:

```tsx
  return (
    <div className="grid h-screen grid-cols-[280px_1fr]">
      <Sidebar
        folders={folders}
        tags={tags}
        notes={notes}
        pending={pending}
        query={query}
        selectedFolderId={folderId}
        selectedNoteId={noteDetail?.id ?? null}
        onQueryChange={setQuery}
        onSelectFolder={selectFolder}
        onSelectNote={openNote}
        folderMutations={{
          onCreate: handleCreateFolder,
          onRename: handleRenameFolder,
          onDelete: handleDeleteFolder,
          onReorder: handleReorderFolders,
        }}
      />
      <main className="flex flex-col px-12 py-10">
```

with:

```tsx
  return (
    <div
      className={`grid h-screen transition-[grid-template-columns] duration-200 ${
        sidebarCollapsed ? 'grid-cols-[0px_1fr]' : 'grid-cols-[280px_1fr]'
      }`}
    >
      <div className="overflow-hidden">
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          pending={pending}
          query={query}
          selectedFolderId={folderId}
          selectedNoteId={noteDetail?.id ?? null}
          onQueryChange={setQuery}
          onSelectFolder={selectFolder}
          onSelectNote={openNote}
          onCollapse={toggleSidebar}
          folderMutations={{
            onCreate: handleCreateFolder,
            onRename: handleRenameFolder,
            onDelete: handleDeleteFolder,
            onReorder: handleReorderFolders,
          }}
        />
      </div>
      <main className="relative flex flex-col px-12 py-10">
        {sidebarCollapsed ? (
          <button
            type="button"
            aria-label={t('expandSidebar')}
            title={t('expandSidebar')}
            onClick={toggleSidebar}
            className="text-muted-foreground/60 hover:text-foreground absolute left-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded text-sm leading-none"
          >
            »
          </button>
        ) : null}
```

The rest of `<main>`'s contents (the `noteDetail ? … : …` block) and the closing `</main></div>` stay exactly as they are.

- [ ] **Step 4: Add a `Sidebar` test for the collapse button**

In `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`, add `collapseSidebar` to the test `messages` — change the `sidebar` block inside the `messages` constant:

```tsx
    sidebar: {
      foldersHeading: 'Folders',
      tagsHeading: 'Tags',
      notesHeading: 'Notes',
      emptyState: 'No notes here yet.',
      loading: 'Loading…',
    },
```

to:

```tsx
    sidebar: {
      foldersHeading: 'Folders',
      tagsHeading: 'Tags',
      notesHeading: 'Notes',
      emptyState: 'No notes here yet.',
      loading: 'Loading…',
      collapseSidebar: 'Collapse sidebar',
    },
```

Then append this `describe` block at the end of the file:

```tsx
describe('Sidebar — collapse control', () => {
  it('shows no collapse button when onCollapse is omitted', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(within(container).queryByLabelText('Collapse sidebar')).toBeNull();
  });

  it('renders a collapse button that calls onCollapse', () => {
    const onCollapse = vi.fn();
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
          onCollapse={onCollapse}
        />,
      ),
    );
    fireEvent.click(within(container).getByLabelText('Collapse sidebar'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
```

(`render`, `wrap`, `within`, `fireEvent`, `vi`, `describe`, `it`, `expect`, and the `folders`/`tags`/`notes` fixtures are all already imported/defined in this file.)

- [ ] **Step 5: Run the tests + typecheck**

Run: `bun run test apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: PASS — existing tests plus the two new collapse-control tests.

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/NotesShell.tsx apps/web/src/components/notes/Sidebar/index.tsx apps/web/src/components/notes/Sidebar/Sidebar.test.tsx apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(notes): collapsible sidebar for full-width writing"
```

---

## Task 4: `htmlToMarkdown` helper

A pure HTML→Markdown converter built on `turndown`. Lives under `lib/notes/**` (coverage-gated). `turndown-plugin-gfm` ships no type declarations, so an ambient module declaration is added.

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/types/turndown-plugin-gfm.d.ts`
- Create: `apps/web/src/lib/notes/markdown.ts`
- Test: `apps/web/src/lib/notes/markdown.test.ts`

- [ ] **Step 1: Add the dependencies**

In `apps/web/package.json`, add to the `"dependencies"` object (keep the object alphabetically sorted — these go between `"react-dom"` and `"y-prosemirror"`, i.e. after `"react-dom": "19.2.5",`):

```json
    "turndown": "7.2.4",
    "turndown-plugin-gfm": "1.0.2",
```

Add to the `"devDependencies"` object:

```json
    "@types/turndown": "5.0.6",
```

(Versions verified with `npm view` — do not change them without re-verifying.)

Then install from the repo root:

Run: `bun install`
Expected: resolves and writes `bun.lock`; `turndown`, `turndown-plugin-gfm`, `@types/turndown` are added.

- [ ] **Step 2: Add ambient types for `turndown-plugin-gfm`**

Create `apps/web/src/types/turndown-plugin-gfm.d.ts`:

```ts
// `turndown-plugin-gfm` ships no type declarations and there is no
// @types package. Declare the small surface we use: each export is a
// Turndown plugin (a function that mutates a TurndownService instance).
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/lib/notes/markdown.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './markdown.ts';

describe('htmlToMarkdown', () => {
  it('converts headings with ATX syntax', () => {
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
    expect(htmlToMarkdown('<h2>Sub</h2>')).toBe('## Sub');
  });

  it('converts bold and italic', () => {
    expect(htmlToMarkdown('<p><strong>bold</strong> and <em>italic</em></p>')).toBe(
      '**bold** and *italic*',
    );
  });

  it('converts bullet lists with a dash marker', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('-   one\n-   two');
  });

  it('converts ordered lists', () => {
    expect(htmlToMarkdown('<ol><li>first</li><li>second</li></ol>')).toBe(
      '1.  first\n2.  second',
    );
  });

  it('converts links', () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">site</a></p>')).toBe(
      '[site](https://example.com)',
    );
  });

  it('converts inline code', () => {
    expect(htmlToMarkdown('<p>run <code>bun test</code></p>')).toBe('run `bun test`');
  });

  it('converts GFM task lists to checkbox syntax', () => {
    const html =
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>done</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>todo</p></div></li>' +
      '</ul>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('[x] done');
    expect(md).toContain('[ ] todo');
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun run test apps/web/src/lib/notes/markdown.test.ts`
Expected: FAIL — `./markdown.ts` does not exist.

- [ ] **Step 5: Implement the converter**

Create `apps/web/src/lib/notes/markdown.ts`:

```ts
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Converts editor HTML to GitHub-flavoured Markdown. Pure and
 * framework-agnostic — it never touches the Tiptap editor instance, so it
 * cannot disturb content parsing, the Collaboration document, or the save
 * path. The GFM plugin adds task lists, strikethrough, and tables.
 *
 * A fresh TurndownService per call keeps the function stateless.
 */
export const htmlToMarkdown = (html: string): string => {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  service.use(gfm);
  return service.turndown(html);
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run test apps/web/src/lib/notes/markdown.test.ts`
Expected: PASS — all 8 tests green.

If the bullet/ordered-list spacing assertions fail because your installed Turndown emits a different number of spaces after the marker, adjust the **test** expectations to match Turndown's actual output (run the test, read the received value, update the `toBe` strings) — the converter config is correct; Turndown's marker spacing is its own well-defined behaviour.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/src/types/turndown-plugin-gfm.d.ts apps/web/src/lib/notes/markdown.ts apps/web/src/lib/notes/markdown.test.ts
git commit -m "feat(notes): htmlToMarkdown helper via turndown"
```

---

## Task 5: Copy-as-Markdown button

A subtle button in the editor's top bar that copies the note as Markdown.

**Files:**
- Create: `apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx`
- Test: `apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx`
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the i18n strings**

In `apps/web/messages/en.json`, add a new `editorActions` block inside `notes`, immediately before the `"editorToolbar"` block:

```json
    "editorActions": {
      "copyMarkdown": "Copy as Markdown",
      "copied": "Copied"
    },
```

In `apps/web/messages/de.json`, add the same block immediately before its `"editorToolbar"` block:

```json
    "editorActions": {
      "copyMarkdown": "Als Markdown kopieren",
      "copied": "Kopiert"
    },
```

- [ ] **Step 2: Add `CopyMarkdownButton.tsx` to the coverage include list**

In `vitest.config.ts`, the `coverage.include` array lists editor components. After the line:

```ts
        'apps/web/src/components/notes/Editor/EditorToolbar.tsx',
```

add:

```ts
        'apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx',
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { Editor } from '@tiptap/react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyMarkdownButton } from './CopyMarkdownButton.tsx';

afterEach(cleanup);

const messages = {
  notes: { editorActions: { copyMarkdown: 'Copy as Markdown', copied: 'Copied' } },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

/** Minimal Editor stub — only `getHTML` is used by the button. */
const editorWith = (html: string): Editor => ({ getHTML: () => html }) as unknown as Editor;

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

describe('CopyMarkdownButton', () => {
  it('copies the editor content as Markdown', async () => {
    const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<h1>Hi</h1>')} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Hi'));
  });

  it('shows "Copied" feedback after a successful copy', async () => {
    const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<p>x</p>')} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    await waitFor(() => expect(within(container).queryByText('Copied')).not.toBeNull());
  });

  it('does nothing when there is no editor', () => {
    const { container } = render(wrap(<CopyMarkdownButton editor={null} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not crash when the clipboard write is rejected', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<p>x</p>')} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(within(container).queryByText('Copied')).toBeNull();
  });

  it('reverts the feedback after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<p>x</p>')} />));
      fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
      await vi.waitFor(() => expect(within(container).queryByText('Copied')).not.toBeNull());
      vi.advanceTimersByTime(2000);
      await vi.waitFor(() => expect(within(container).queryByText('Copied')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun run test apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx`
Expected: FAIL — `./CopyMarkdownButton.tsx` does not exist.

- [ ] **Step 5: Implement `CopyMarkdownButton.tsx`**

Create `apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx`:

```tsx
'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { htmlToMarkdown } from '@/lib/notes/markdown.ts';

type Props = {
  editor: Editor | null;
};

/**
 * Subtle button in the editor's top bar that copies the current note as
 * Markdown. The conversion reads `editor.getHTML()` and runs it through the
 * pure `htmlToMarkdown` helper — it never touches the editor's extensions,
 * the collab document, or the save path. Shows brief "Copied" feedback.
 */
export function CopyMarkdownButton({ editor }: Props) {
  const t = useTranslations('notes.editorActions');
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!editor) return;
    const markdown = htmlToMarkdown(editor.getHTML());
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable / permission denied — leave state unchanged
    }
  }, [editor]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={t('copyMarkdown')}
      title={t('copyMarkdown')}
      className="text-muted-foreground/50 hover:text-foreground inline-flex items-center gap-1 rounded text-xs transition-colors"
    >
      {copied ? (
        <span>✓ {t('copied')}</span>
      ) : (
        <span aria-hidden="true" className="text-sm leading-none">
          ⧉
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run test apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Mount the button in the editor top bar**

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`, add the import after the `SaveIndicator` import:

```tsx
import { CopyMarkdownButton } from './CopyMarkdownButton.tsx';
```

In `CollaborativeEditor`'s returned JSX, replace the editor top bar — currently:

```tsx
      <div className="border-paper-line/60 mb-4 flex items-center justify-between border-b pb-2">
        <PresenceBar users={presence} />
        <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
      </div>
```

with:

```tsx
      <div className="border-paper-line/60 mb-4 flex items-center justify-between border-b pb-2">
        <PresenceBar users={presence} />
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
          <CopyMarkdownButton editor={editor} />
        </div>
      </div>
```

Leave the skeleton top bar (in `NoteEditorSkeleton`) unchanged — there is no editor there yet.

- [ ] **Step 8: Verify typecheck + the test still passes**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run test apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx apps/web/src/components/notes/Editor/NoteEditor.tsx apps/web/messages/en.json apps/web/messages/de.json vitest.config.ts
git commit -m "feat(notes): copy-as-Markdown button in the editor"
```

---

## Task 6: Full verification

Run the complete suite (the API route tests are integration tests needing Postgres + Redis — start them with `make up` if not running).

**Files:** none — verification only.

- [ ] **Step 1: Type + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 2: Full test suite with coverage**

Run: `bun run test --coverage`
Expected: PASS — all tests green; coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The new coverage-gated files — `lib/notes/use-sidebar-collapsed.ts`, `lib/notes/markdown.ts`, `components/notes/Editor/CopyMarkdownButton.tsx` — must each stay above threshold.

- [ ] **Step 3: If coverage dips below threshold**

Identify the uncovered lines from the coverage report and add targeted tests to the matching `*.test.ts(x)` file (`use-sidebar-collapsed.test.ts`, `markdown.test.ts`, or `CopyMarkdownButton.test.tsx`). Re-run Step 2. Commit any added tests:

```bash
git add apps/web/src/lib/notes apps/web/src/components/notes/Editor
git commit -m "test(notes): close coverage gap in editor-polish helpers"
```

- [ ] **Step 4: Next build**

Run: `bun run build`
Expected: the Next build of `apps/web` completes with no error. Confirms `turndown` bundles for the client and the new components compile.

- [ ] **Step 5: Working tree check**

Run: `git status --short`
Expected: no uncommitted changes from this plan's files. (Pre-existing untracked items such as `.vscode/`, `bunfig.toml`, `scripts/`, and a regenerated `apps/web/next-env.d.ts` are unrelated — report but do not commit them.)

---

## Self-Review

**Spec coverage:**
- Spec §1 (hide native search `×`) → Task 1 Step 2. ✅
- Spec §2 (remove editor focus outline) → Task 1 Step 2. ✅
- Spec §3 (unify editor font to Inter — headings + note title) → Task 1 Steps 1 & 3. ✅
- Spec §4 (collapsible sidebar — persisted, keyboard, expand/collapse controls) → Task 2 (hook) + Task 3 (UI wiring, i18n). ✅
- Spec §5 (copy-as-Markdown button, top-right, turndown-based, isolated) → Task 4 (`htmlToMarkdown`) + Task 5 (button + NoteEditor wiring, i18n). ✅
- Spec "Testing" (CSS verified by build+lint; items 4 & 5 unit-tested; new gated files added to coverage include) → Task 1 Steps 4-5, Task 2/4/5 tests, Task 5 Step 2 (`vitest.config.ts`), Task 6. ✅
- Image paste/drop is a non-goal — correctly absent from every task. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete content. Task 4 Step 6 gives an explicit, bounded fallback for Turndown's marker-spacing (adjust the test expectations to observed output) rather than a vague "fix as needed".

**Type consistency:** `useSidebarCollapsed` returns `readonly [boolean, () => void]`; Task 3 destructures it as `[sidebarCollapsed, toggleSidebar]` and passes `toggleSidebar` to both `Sidebar.onCollapse` and the expand button. `Sidebar`'s new `onCollapse?: () => void` matches. `htmlToMarkdown(html: string): string` defined in Task 4 is imported and called with `editor.getHTML()` (string) in Task 5. `CopyMarkdownButton`'s `editor: Editor | null` prop matches the `editor` value passed from `NoteEditor`'s `useEditor` result (which is `Editor | null`). i18n namespaces: `notes.editorActions` used by `CopyMarkdownButton`, `notes.sidebar.collapseSidebar` by `Sidebar`, `notes.shell.expandSidebar` by `NotesShell` — each component already calls `useTranslations` for its namespace.
