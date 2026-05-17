# Two-Pane Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the folder tree and the notes list side by side in the sidebar, and turn note rows into cards showing a note icon, title, body-preview snippet, and last-edited date.

**Architecture:** Pure frontend + one additive API field. `NoteListItem` gains a server-derived `snippet`; the sidebar `<aside>` splits its lower area into two side-by-side panes (folder tree | notes list) and widens; note rows are restyled as cards. No schema/migration change.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Prisma 7, Zod, Vitest + jsdom + @testing-library/react, TailwindCSS 4, next-intl.

**Spec:** `docs/superpowers/specs/2026-05-17-two-pane-sidebar-design.md`

**Conventions:** TDD where a task specifies a test. TypeScript strict (no `any` without `// reason:`). Conventional Commits. lefthook pre-commit MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root (quote paths with `[` brackets). `timeout` is unavailable on macOS. Commit directly to `main` (trunk-based, user-consented).

---

## Task 1: `toSnippet` helper

**Files:**
- Create: `apps/web/src/lib/notes/snippet.ts`
- Create: `apps/web/src/lib/notes/snippet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/snippet.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toSnippet } from './snippet.ts';

describe('toSnippet', () => {
  it('collapses whitespace and newlines into single spaces', () => {
    expect(toSnippet('hello\n\n  world\tagain')).toBe('hello world again');
  });

  it('trims leading/trailing whitespace', () => {
    expect(toSnippet('   padded   ')).toBe('padded');
  });

  it('returns an empty string for an empty body', () => {
    expect(toSnippet('')).toBe('');
    expect(toSnippet('   \n  ')).toBe('');
  });

  it('caps the result at 140 characters', () => {
    const long = 'x'.repeat(500);
    expect(toSnippet(long)).toHaveLength(140);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/snippet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/notes/snippet.ts`:
```ts
const SNIPPET_LEN = 140;

/**
 * A short, single-line preview of a note's body for the sidebar list.
 * Collapses all whitespace, trims, and caps the length. The full body is
 * never sent to the client — only this snippet.
 */
export const toSnippet = (body: string): string =>
  body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/snippet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/snippet.ts apps/web/src/lib/notes/snippet.test.ts
git commit -m "feat(notes): toSnippet body-preview helper"
```

---

## Task 2: `NoteListItem.snippet` — type + API + propagation

**Files:**
- Modify: `apps/web/src/lib/api/schemas.ts`
- Modify: `apps/web/src/app/api/notes/route.ts`
- Modify: `apps/web/src/app/api/notes/[id]/route.ts`
- Modify: `apps/web/src/app/api/notes/[id]/duplicate/route.ts`
- Modify: `apps/web/src/app/notes/page.tsx`
- Modify: `apps/web/src/app/notes/[noteId]/page.tsx`
- Modify: `apps/web/src/app/api/notes/route.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/src/app/api/notes/route.test.ts`, append a test in the `GET /api/notes` describe block:
```ts
it('returns a snippet derived from the body, not the full body', async () => {
  const { user } = await makeTestUser();
  setAuthed(user);
  await prisma.note.create({
    data: {
      title: 'api-test-snippet',
      body: 'First line of the note.\n\nSecond paragraph here.',
      authorId: user.id,
    },
  });
  const res = await GET(new Request('http://localhost/api/notes'));
  const body = (await res.json()) as { notes: Array<Record<string, unknown>> };
  const item = body.notes.find((n) => n.title === 'api-test-snippet');
  expect(item).toBeDefined();
  expect(item?.snippet).toBe('First line of the note. Second paragraph here.');
  expect(item).not.toHaveProperty('body');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/app/api/notes/route.test.ts`
Expected: FAIL — list items have no `snippet`.

- [ ] **Step 3: Add `snippet` to the type**

In `apps/web/src/lib/api/schemas.ts`, add `snippet: string` to the `NoteListItem` type. (`NoteDetail` extends `NoteListItem`, so it inherits the field — its builders are updated below too.)

- [ ] **Step 4: Derive `snippet` in `GET`/`POST /api/notes`**

In `apps/web/src/app/api/notes/route.ts`:
- Add the import: `import { toSnippet } from '@/lib/notes/snippet.ts';`
- `toListItem`: add `body: string` to its input parameter type and `snippet: toSnippet(n.body)` to the returned object. Do NOT add `body` to the returned object.
- The `GET` list `findMany` `select`: add `body: true`.
- The `POST` create `select`: add `body: true` (so `toListItem(created)` has the body — a new note's body is `''`, yielding an empty snippet).

- [ ] **Step 5: Derive `snippet` in the other `NoteListItem`/`NoteDetail` builders**

- `apps/web/src/app/api/notes/[id]/route.ts` — `toDetail` builds a `NoteDetail` and already has the note's `body`; import `toSnippet` and add `snippet: toSnippet(n.body)` to the returned object. (`noteSelect` already includes `body`.)
- `apps/web/src/app/api/notes/[id]/duplicate/route.ts` — its `toListItem` returns a `NoteListItem`; add `body: string` to its input type, add `body: true` to the `note.create` `select`, and set `snippet: toSnippet(n.body)`.
- `apps/web/src/app/notes/page.tsx` and `apps/web/src/app/notes/[noteId]/page.tsx` — import `toSnippet`; add `body: true` to the `note.findMany` `select`; each `initialNotes` item gets `snippet: toSnippet(n.body)`. In `[noteId]/page.tsx`, the target-note `findUnique` already selects `body`, so the `initialNote` object also gets `snippet: toSnippet(note.body)`.

- [ ] **Step 6: Green-keep the remaining builders**

Run `bun run typecheck`. Fix every remaining `NoteListItem`/`NoteDetail`-missing-`snippet` error — test fixtures and any other literal get `snippet: ''` (or a real value where a test asserts on it). Re-run until clean.

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/app/api/notes/route.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api/schemas.ts apps/web/src/app/api/notes apps/web/src/app/notes
git commit -m "feat(notes): NoteListItem.snippet, server-derived from body"
```

---

## Task 3: Two-pane sidebar layout

**Files:**
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

First read `Sidebar/index.tsx` and `Sidebar.test.tsx`.

In `Sidebar.test.tsx`, add a test: render `Sidebar` (with the test harness's standard props) and assert the folder area and the notes area are now **separate sibling sections** — e.g. query the folder section by its `aria-label` (`notes.sidebar.foldersHeading` translation) and the notes section by its `aria-label` (`notes.sidebar.notesHeading` translation), assert both exist, and assert the `FolderTree` (`screen.getByRole('tree')`) is inside the folder section while the notes list (`screen.getByRole('list', { name: <notesHeading> })`) is inside the notes section — i.e. neither contains the other. (Use `within(...)` from `@testing-library/react`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: FAIL — today a single `<section>` wraps both.

- [ ] **Step 3: Widen the sidebar grid in `NotesShell`**

In `apps/web/src/components/notes/NotesShell.tsx`, the outer grid `className` has `grid-cols-[280px_1fr]` for the expanded sidebar — change `280px` to `480px`. Leave the collapsed `grid-cols-[0px_1fr]` unchanged.

- [ ] **Step 4: Restructure `Sidebar` into two panes**

In `apps/web/src/components/notes/Sidebar/index.tsx`:
- The `<aside>`'s `min-w-[280px]` → `min-w-[480px]`.
- Today a single `<section aria-label={t('foldersHeading')} className="flex-1 overflow-y-auto">` contains, in order: the folders heading row + ＋ button, the inline folder-create `<input>`, `<FolderTree>`, the `createError` block, the notes heading row + ＋ button, and the notes `<ul>`. Replace that single `<section>` with a two-column row:
  ```tsx
  <div className="flex min-h-0 flex-1 gap-3">
    <section
      aria-label={t('foldersHeading')}
      className="flex w-[200px] flex-shrink-0 flex-col overflow-y-auto"
    >
      {/* folders heading row + ＋ button */}
      {/* inline folder-create input (when creating) */}
      {/* <FolderTree …/> */}
      {/* createError block */}
    </section>
    <section
      aria-label={t('notesHeading')}
      className="border-paper-line/80 flex min-w-0 flex-1 flex-col overflow-y-auto border-l pl-3"
    >
      {/* notes heading row + ＋ button */}
      {/* notes <ul> */}
    </section>
  </div>
  ```
  Move the existing JSX blocks into the two sections exactly as listed — do not change their internal markup in this task (the note-row restyle is Task 4). Keep all existing props, handlers, and state.
- Avoid a duplicate accessible name: the notes `<section>` now carries `aria-label={t('notesHeading')}`. Remove the `aria-label` from the inner notes `<ul>` (the section labels the region; the `<ul>` stays a plain list) — or keep the `<ul>` label and drop it from the section. Pick one so there is exactly one element with that accessible name; update the Step-1 test query to match the choice.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: PASS (all tests — the pre-existing sidebar tests must stay green; adjust any query that depended on the old single-section structure).
Run `bun run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/NotesShell.tsx apps/web/src/components/notes/Sidebar/index.tsx apps/web/src/components/notes/Sidebar/Sidebar.test.tsx
git commit -m "feat(notes): two-pane sidebar — folders beside notes"
```

---

## Task 4: Note rows as cards (icon, title, snippet, date)

**Files:**
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

In `Sidebar.test.tsx`, add a test: render `Sidebar` with a note whose fixture has a known `title`, a non-empty `snippet`, and an `updatedAt`; assert the rendered note row shows the title text AND the snippet text; assert it does NOT render tag chips (query for the note's tag name and expect it absent — give the fixture note a tag to make the assertion meaningful). Match the file's existing note fixture shape (it already includes `snippet` after Task 2 — set a real snippet value).

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: FAIL — the row shows tag chips and no snippet.

- [ ] **Step 3: Restyle the note row**

In `apps/web/src/components/notes/Sidebar/index.tsx`:
- Add the import: `import { useFormatter } from 'next-intl';` and, inside the `Sidebar` component, `const format = useFormatter();`.
- In the `notes.map` row render, replace the inner content of the note's select `<button>` (currently a truncated title `<div>` plus the tag-chips `<div>`) with a card layout:
  ```tsx
  <div className="flex items-start gap-1.5">
    <span aria-hidden="true" className="mt-0.5 text-xs leading-none">📄</span>
    <div className="min-w-0 flex-1">
      <div className="font-display line-clamp-2 text-sm">{n.title}</div>
      {n.snippet ? (
        <div className="text-muted-foreground/70 line-clamp-2 mt-0.5 text-xs">
          {n.snippet}
        </div>
      ) : null}
      <div className="text-muted-foreground/60 mt-1 text-[10px]">
        {format.relativeTime(new Date(n.updatedAt))}
      </div>
    </div>
  </div>
  ```
  Remove the tag-chips block entirely. Keep the `<button>`'s `onClick`, `aria-current`, and its classes; keep everything outside the button (the row `<li>`, draggable handlers, the rename input branch, the rename/duplicate/share action buttons) exactly as-is.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: PASS (all tests). Run `bun run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/index.tsx apps/web/src/components/notes/Sidebar/Sidebar.test.tsx
git commit -m "feat(notes): note rows show icon, snippet, and date"
```

---

## Task 5: Full verification

**Files:** `vitest.config.ts` only if a coverage gap is found.

- [ ] **Step 1: Full test suite**

Run: `bun run vitest run`
Expected: all test files pass. `apps/web/src/lib/notes/snippet.ts` is covered by the existing `apps/web/src/lib/notes/**/*.ts` coverage glob — no `vitest.config.ts` change is expected. If the coverage gate fails for a genuinely-uncovered new file, add it to the `include` array and re-run.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 3: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. Catches Turbopack-only compile errors that `vitest`/`tsc` miss. If it fails, fix the reported file and re-run Steps 1–3.

- [ ] **Step 4: Commit (only if a coverage-config change was needed)**

```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for the two-pane sidebar"
```
Otherwise nothing to commit.

---

## Self-Review

**Spec coverage:**
- `toSnippet` helper → Task 1.
- `NoteListItem.snippet` + server derivation + propagation to every builder → Task 2.
- Two-pane layout (folder pane | notes pane), widened sidebar → Task 3.
- Note rows as cards (icon, title, snippet, date), tag chips dropped → Task 4.
- Behaviour unchanged underneath → Tasks 3/4 keep all props, handlers, state.
- Light theme kept → no theme change in any task.
- Turbopack verification → Task 5.
- No new i18n key — the panes reuse the existing `notes.sidebar.foldersHeading` / `notesHeading` keys (the spec's "if needed" condition is not met); no i18n task.

**Placeholder scan:** No "TBD"/"implement later". Task 3 Step 4 shows the exact two-section structure and says to move the existing blocks unchanged; Task 4 Step 3 gives the full replacement JSX for the row's button content.

**Type consistency:** `snippet: string` is the field name on `NoteListItem` (Task 2), consumed as `n.snippet` in Task 4. `toSnippet(body: string): string` defined in Task 1, called in Task 2's `toListItem`/`toDetail` and the RSC pages with the same signature. The two `<section aria-label>` values use the existing `t('foldersHeading')` / `t('notesHeading')` translations consistently in Tasks 3 and the Task 3/4 tests.
