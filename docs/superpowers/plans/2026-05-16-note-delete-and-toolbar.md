# Note Delete + Editor Toolbar Repositioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hard-delete button to the note editor toolbar (with a confirmation pop-up) and reposition the toolbar so the copy/delete actions and the right-panel toggle are placed deliberately.

**Architecture:** A new self-contained `DeleteNoteButton` client component calls the existing `notesApi.delete()` (hard delete) after a native `window.confirm`, then navigates to the note index. The editor toolbar gains the delete button; the `☰` panel toggle is replaced by a guillemet pair (`«` / `»`) mirroring the left sidebar's collapse/expand affordance. No API, database, or schema changes — `DELETE /api/notes/[id]?hard=1` and `notesApi.delete()` already exist.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tiptap 3, next-intl, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-16-note-delete-and-toolbar-design.md` — read it before starting.

**Branch:** Work happens on `feat/notes-delete-toolbar` (already created off `feat/notes-doc-panel`). Do not switch branches.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/web/src/components/notes/Editor/DeleteNoteButton.tsx` | **new** — the delete button: confirm → `notesApi.delete` → navigate |
| `apps/web/src/components/notes/Editor/DeleteNoteButton.test.tsx` | **new** — unit tests |
| `apps/web/messages/en.json` | new `notes.editorActions` keys |
| `apps/web/messages/de.json` | same new keys |
| `vitest.config.ts` | coverage `include` gains `DeleteNoteButton.tsx` |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | toolbar: add delete button + delete-error notice; thread `initialTitle`; replace `☰` with the guillemet toggle |
| `apps/web/src/components/notes/Editor/DocumentPanel.tsx` | renders the collapse `»` button; gains an `onCollapse` prop |
| `apps/web/src/components/notes/Editor/DocumentPanel.test.tsx` | extended for the collapse button |

`NoteEditor.tsx` is intentionally **not** in the `vitest.config.ts` coverage `include` list (its `useEditor` + live WebSocket make it an E2E target, per the file's own comment) — Tasks 2 and 3's changes to it are verified by typecheck, lint, and the Next build.

---

## Task 1: `DeleteNoteButton` component

**Files:**
- Create: `apps/web/src/components/notes/Editor/DeleteNoteButton.tsx`
- Create: `apps/web/src/components/notes/Editor/DeleteNoteButton.test.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/Editor/DeleteNoteButton.test.tsx`. It mirrors `CopyMarkdownButton.test.tsx`'s style (jsdom, Testing Library, `NextIntlClientProvider` wrap). `next/navigation` and the api-client are module-mocked; `vi.hoisted` is required because `vi.mock` factories are hoisted above `const` declarations.

```tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push, deleteNote } = vi.hoisted(() => ({ push: vi.fn(), deleteNote: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/notes/api-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notes/api-client.ts')>();
  return { ...actual, notesApi: { ...actual.notesApi, delete: deleteNote } };
});

import { ApiError } from '@/lib/notes/api-client.ts';
import { DeleteNoteButton } from './DeleteNoteButton.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    editorActions: {
      delete: 'Delete note',
      confirmDelete: 'Delete note "{title}"?',
      deleteFailed: 'Could not delete the note. Please try again.',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

beforeEach(() => {
  push.mockReset();
  deleteNote.mockReset();
});

describe('DeleteNoteButton', () => {
  it('does nothing when the confirmation is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onError = vi.fn();
    const { container } = render(
      wrap(<DeleteNoteButton noteId="n1" noteTitle="My note" onError={onError} />),
    );
    fireEvent.click(within(container).getByLabelText('Delete note'));
    expect(deleteNote).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('deletes the note and navigates to the index when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteNote.mockResolvedValue({ deleted: true });
    const onError = vi.fn();
    const { container } = render(
      wrap(<DeleteNoteButton noteId="n1" noteTitle="My note" onError={onError} />),
    );
    fireEvent.click(within(container).getByLabelText('Delete note'));
    await waitFor(() => expect(deleteNote).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/notes'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports an error and does not navigate when the delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteNote.mockRejectedValue(new ApiError(500, 'boom', null));
    const onError = vi.fn();
    const { container } = render(
      wrap(<DeleteNoteButton noteId="n1" noteTitle="My note" onError={onError} />),
    );
    fireEvent.click(within(container).getByLabelText('Delete note'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'));
    expect(push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest apps/web/src/components/notes/Editor/DeleteNoteButton.test.tsx`
Expected: FAIL — `DeleteNoteButton` cannot be resolved (`./DeleteNoteButton.tsx` does not exist).

- [ ] **Step 3: Implement `DeleteNoteButton.tsx`**

Create `apps/web/src/components/notes/Editor/DeleteNoteButton.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { ApiError, notesApi } from '@/lib/notes/api-client.ts';

type Props = {
  noteId: string;
  noteTitle: string;
  /** Called with a user-facing message when the delete request fails. */
  onError: (message: string) => void;
};

/**
 * Hard-deletes the current note after an explicit `window.confirm`, then
 * navigates back to the note index. A failed delete keeps the user on the
 * note and reports the message via `onError`. Styled like CopyMarkdownButton —
 * small and unobtrusive — with a danger-red hover for the destructive action.
 */
export function DeleteNoteButton({ noteId, noteTitle, onError }: Props) {
  const t = useTranslations('notes.editorActions');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = useCallback(async () => {
    if (busy) return;
    if (!window.confirm(t('confirmDelete', { title: noteTitle }))) return;
    setBusy(true);
    try {
      await notesApi.delete(noteId);
      router.push('/notes');
    } catch (err) {
      setBusy(false);
      onError(err instanceof ApiError ? err.message : t('deleteFailed'));
    }
  }, [busy, noteId, noteTitle, onError, router, t]);

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy}
      aria-label={t('delete')}
      title={t('delete')}
      className="text-muted-foreground/50 hover:text-danger inline-flex items-center rounded text-xs transition-colors"
    >
      <span aria-hidden="true" className="text-sm leading-none">
        ✕
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Add the i18n keys**

In `apps/web/messages/en.json`, replace the `notes.editorActions` block:

```json
    "editorActions": {
      "copyMarkdown": "Copy as Markdown",
      "copied": "Copied"
    },
```

with:

```json
    "editorActions": {
      "copyMarkdown": "Copy as Markdown",
      "copied": "Copied",
      "delete": "Delete note",
      "confirmDelete": "Delete note \"{title}\"?",
      "deleteFailed": "Could not delete the note. Please try again."
    },
```

In `apps/web/messages/de.json`, replace the `notes.editorActions` block:

```json
    "editorActions": {
      "copyMarkdown": "Als Markdown kopieren",
      "copied": "Kopiert"
    },
```

with:

```json
    "editorActions": {
      "copyMarkdown": "Als Markdown kopieren",
      "copied": "Kopiert",
      "delete": "Notiz löschen",
      "confirmDelete": "Notiz \"{title}\" löschen?",
      "deleteFailed": "Die Notiz konnte nicht gelöscht werden. Bitte erneut versuchen."
    },
```

- [ ] **Step 5: Add the component to the coverage gate**

In `vitest.config.ts`, in `test.coverage.include`, add the new file directly after the `CopyMarkdownButton.tsx` line:

```ts
        'apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx',
        'apps/web/src/components/notes/Editor/DeleteNoteButton.tsx',
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run vitest apps/web/src/components/notes/Editor/DeleteNoteButton.test.tsx`
Expected: PASS — all three cases.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/notes/Editor/DeleteNoteButton.tsx apps/web/src/components/notes/Editor/DeleteNoteButton.test.tsx apps/web/messages/en.json apps/web/messages/de.json vitest.config.ts
git commit -m "feat(notes): DeleteNoteButton — confirm + hard-delete a note"
```

---

## Task 2: Wire the delete button into the editor toolbar

**Files:**
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`

This task adds `DeleteNoteButton` to the toolbar and the delete-error notice. It leaves the `☰` panel-toggle button in place — Task 3 replaces it — so the editor stays fully working after this commit.

`NoteEditor.tsx` has no unit-test harness (it is excluded from the coverage gate; its `useEditor` + WebSocket make it an E2E target). This task is verified by typecheck, lint, and — in Task 4 — the Next build.

- [ ] **Step 1: Thread `initialTitle` through to `CollaborativeEditor`**

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`:

a) In the `NoteEditor` function signature, stop discarding `initialTitle`. Change:

```tsx
export function NoteEditor({
  noteId,
  initialTitle: _initialTitle,
  initialBody,
  initialUpdatedAt,
  currentUser,
}: Props) {
```

to:

```tsx
export function NoteEditor({
  noteId,
  initialTitle,
  initialBody,
  initialUpdatedAt,
  currentUser,
}: Props) {
```

b) In the `<CollaborativeEditor … />` render inside `NoteEditor`, add the `initialTitle` prop:

```tsx
  return (
    <CollaborativeEditor
      noteId={noteId}
      ydoc={ydoc}
      provider={provider}
      presence={presence}
      initialTitle={initialTitle}
      initialBody={initialBody}
      initialUpdatedAt={initialUpdatedAt}
      currentUser={currentUser}
    />
  );
```

c) In the `CollaborativeEditor` function, add `initialTitle` to the destructured params and to the inline props type. Change:

```tsx
function CollaborativeEditor({
  noteId,
  ydoc,
  provider,
  presence,
  initialBody,
  initialUpdatedAt,
  currentUser,
}: {
  noteId: string;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  presence: ReadonlyArray<PresenceUser>;
  initialBody: string;
  initialUpdatedAt: string;
  currentUser: { id: string; name: string; color: string };
}) {
```

to:

```tsx
function CollaborativeEditor({
  noteId,
  ydoc,
  provider,
  presence,
  initialTitle,
  initialBody,
  initialUpdatedAt,
  currentUser,
}: {
  noteId: string;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  presence: ReadonlyArray<PresenceUser>;
  initialTitle: string;
  initialBody: string;
  initialUpdatedAt: string;
  currentUser: { id: string; name: string; color: string };
}) {
```

- [ ] **Step 2: Add the import**

Near the top of `NoteEditor.tsx`, add the import beside the existing `CopyMarkdownButton` import (biome will order it):

```tsx
import { DeleteNoteButton } from './DeleteNoteButton.tsx';
```

- [ ] **Step 3: Add the `deleteError` state and its auto-dismiss effect**

In `CollaborativeEditor`, beside the existing `useState` hooks (next to `const [uploadError, setUploadError] = useState<UploadErrorDetail | null>(null);`), add:

```tsx
  const [deleteError, setDeleteError] = useState<string | null>(null);
```

After the existing upload-error auto-dismiss `useEffect` (the one ending `}, [uploadError]);`), add a mirror for the delete error:

```tsx
  // Auto-dismiss the delete-failure notice — same transient treatment as the
  // upload-error notice above.
  useEffect(() => {
    if (!deleteError) return;
    const timer = window.setTimeout(() => setDeleteError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [deleteError]);
```

- [ ] **Step 4: Render the delete button in the toolbar cluster**

In `CollaborativeEditor`'s header row, in the right-hand control cluster, add `DeleteNoteButton` immediately after `CopyMarkdownButton`. Change:

```tsx
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
            <CopyMarkdownButton editor={editor} />
            <button
```

to:

```tsx
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
            <CopyMarkdownButton editor={editor} />
            <DeleteNoteButton noteId={noteId} noteTitle={initialTitle} onError={setDeleteError} />
            <button
```

(The `<button>` shown is the existing `☰` toggle — leave it untouched in this task.)

- [ ] **Step 5: Render the delete-error notice**

Directly after the existing `{uploadError ? ( … ) : null}` block, add a parallel notice for the delete error:

```tsx
        {deleteError ? (
          <div
            role="alert"
            className="text-danger mb-2 flex items-center justify-between gap-2 rounded bg-red-50 px-2 py-1 text-xs"
          >
            <span>{deleteError}</span>
            <button type="button" onClick={() => setDeleteError(null)} className="underline">
              {tUpload('dismiss')}
            </button>
          </div>
        ) : null}
```

(`tUpload` is the existing `useTranslations('notes.editorUpload')` hook in `CollaborativeEditor`; `notes.editorUpload.dismiss` already exists and is a generic "Dismiss" label.)

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun run lint`
Expected: PASS (pre-existing unrelated warnings acceptable; any *error* is a real failure).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/notes/Editor/NoteEditor.tsx
git commit -m "feat(notes): add delete-note button to the editor toolbar"
```

---

## Task 3: Replace the `☰` toggle with a left-sidebar-style guillemet toggle

**Files:**
- Modify: `apps/web/src/components/notes/Editor/DocumentPanel.tsx`
- Modify: `apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`

The `☰` button is removed and replaced by a guillemet pair: a collapse `»` inside `DocumentPanel` (shown when the panel is open) and an expand `«` in the editor area (shown when the panel is closed) — mirroring the left sidebar's `«` / `»` collapse/expand buttons.

- [ ] **Step 1: Update `DocumentPanel.test.tsx` for the new `onCollapse` prop and add the failing test**

In `apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`:

a) Add a `hide` key to the test `messages` — inside `messages.notes.docPanel`, after `"links": 'Links',`:

```tsx
      links: 'Links',
      hide: 'Hide document panel',
      internal: 'Internal',
```

b) Immediately after the `wrap` helper definition, add a render helper:

```tsx
const renderPanel = (editor: Editor | null, onCollapse: () => void = () => {}) =>
  render(wrap(<DocumentPanel editor={editor} onCollapse={onCollapse} />));
```

c) Replace every existing `render(wrap(<DocumentPanel editor={EXPR} />))` call with `renderPanel(EXPR)` — the `editor` expression (`makeEditor()`, `makeTwoHeadingEditor()`, `makeImageEditor()`, `null`, or `editor`) is unchanged. There are 10 such calls; `const { container } = render(wrap(<DocumentPanel editor={null} />))` becomes `const { container } = renderPanel(null)`.

d) Add a new test at the end of the `describe('DocumentPanel', …)` block:

```tsx
  it('invokes onCollapse when the collapse button is clicked', () => {
    const onCollapse = vi.fn();
    renderPanel(makeEditor(), onCollapse);
    fireEvent.click(screen.getByLabelText('Hide document panel'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`
Expected: FAIL — `DocumentPanel` does not accept `onCollapse` and renders no "Hide document panel" button.

- [ ] **Step 3: Add the collapse button + `onCollapse` prop to `DocumentPanel.tsx`**

In `apps/web/src/components/notes/Editor/DocumentPanel.tsx`:

a) Change the `Props` type:

```tsx
type Props = { editor: Editor | null; onCollapse: () => void };
```

b) Change the function signature:

```tsx
export function DocumentPanel({ editor, onCollapse }: Props) {
```

c) In the returned JSX, add `relative` to the `<aside>` class and render the collapse button as its first child. Change:

```tsx
  return (
    <aside className="doc-panel" aria-label={t('title')}>
      <OutlineSection headings={items.headings} activeIndex={activeIndex} onSelect={handleSelect} />
```

to:

```tsx
  return (
    <aside className="doc-panel relative" aria-label={t('title')}>
      <button
        type="button"
        aria-label={t('hide')}
        title={t('hide')}
        onClick={onCollapse}
        className="text-muted-foreground/60 hover:text-foreground absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-sm leading-none"
      >
        <span aria-hidden="true">»</span>
      </button>
      <OutlineSection headings={items.headings} activeIndex={activeIndex} onSelect={handleSelect} />
```

(`t` is the existing `useTranslations('notes.docPanel')` hook; `notes.docPanel.hide` already exists in both message catalogues.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`
Expected: PASS — the existing cases and the new collapse-button case.

- [ ] **Step 5: Replace the `☰` button with the guillemet toggle in `NoteEditor.tsx`**

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`, in `CollaborativeEditor`:

a) Remove the `☰` toggle button from the control cluster. Change:

```tsx
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
            <CopyMarkdownButton editor={editor} />
            <DeleteNoteButton noteId={noteId} noteTitle={initialTitle} onError={setDeleteError} />
            <button
              type="button"
              className="text-muted-foreground/70 hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded text-sm"
              aria-label={panelOpen ? tPanel('hide') : tPanel('show')}
              aria-pressed={panelOpen}
              title={panelOpen ? tPanel('hide') : tPanel('show')}
              onClick={togglePanel}
            >
              <span aria-hidden="true">☰</span>
            </button>
          </div>
```

to:

```tsx
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
            <CopyMarkdownButton editor={editor} />
            <DeleteNoteButton noteId={noteId} noteTitle={initialTitle} onError={setDeleteError} />
          </div>
```

b) Make the outer container `relative` and render the panel / expand-button conditionally. Change:

```tsx
  return (
    <div className="flex h-full justify-center">
      <div className="relative flex h-full min-w-0 max-w-[212mm] flex-1 flex-col">
```

to:

```tsx
  return (
    <div className="relative flex h-full justify-center">
      {panelOpen ? null : (
        <button
          type="button"
          aria-label={tPanel('show')}
          title={tPanel('show')}
          onClick={togglePanel}
          className="text-muted-foreground/60 hover:text-foreground absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded text-sm leading-none"
        >
          <span aria-hidden="true">«</span>
        </button>
      )}
      <div className="relative flex h-full min-w-0 max-w-[212mm] flex-1 flex-col">
```

c) Pass `onCollapse` to `DocumentPanel`. Change the last line before the closing `</div>`:

```tsx
      {panelOpen ? <DocumentPanel editor={editor} /> : null}
    </div>
  );
```

to:

```tsx
      {panelOpen ? <DocumentPanel editor={editor} onCollapse={togglePanel} /> : null}
    </div>
  );
```

(`tPanel` — `useTranslations('notes.docPanel')` — and `panelOpen` / `togglePanel` from `useDocPanel()` are all already present in `CollaborativeEditor`; no new hooks. `notes.docPanel.show` already exists.)

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun run lint`
Expected: PASS (pre-existing unrelated warnings acceptable; any *error* is a real failure).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/notes/Editor/DocumentPanel.tsx apps/web/src/components/notes/Editor/DocumentPanel.test.tsx apps/web/src/components/notes/Editor/NoteEditor.tsx
git commit -m "feat(notes): replace panel toggle with sidebar-style guillemet buttons"
```

---

## Task 4: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Type + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS (pre-existing unrelated lint warnings acceptable; any *error* is a real failure).

- [ ] **Step 2: Full test suite with coverage**

Ensure Postgres + Redis are running (`docker ps`; `make up` from the repo root if not — integration tests in the suite need them).

Run: `bun run test --coverage`
Expected: PASS — all tests green; coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The changed coverage-gated files — `DeleteNoteButton.tsx` and `DocumentPanel.tsx` — must stay above threshold.

- [ ] **Step 3: If coverage dips below threshold**

If (and only if) Step 2 reports a coverage failure: identify the uncovered lines from the report, add targeted tests to `DeleteNoteButton.test.tsx` or `DocumentPanel.test.tsx`, re-run Step 2, then commit:

```bash
git add apps/web/src/components/notes/Editor
git commit -m "test(notes): close coverage gap in note delete + toolbar"
```

If coverage already passes, skip this step.

- [ ] **Step 4: Next build**

Run: `bun run build`
Expected: the `@app/web` Next build completes with no error. (A pre-existing worker `bun build` multi-entry-output CLI error predates this work — unrelated; report it but do not act on it.)

- [ ] **Step 5: Working tree check**

Run: `git status --short`
Expected: no uncommitted changes from this plan's files. Pre-existing untracked items (`.vscode/`, `bunfig.toml`, `docs/issues/`, `scripts/`) and a regenerated `apps/web/next-env.d.ts` are unrelated — report but do not commit them.

---

## Self-Review

**Spec coverage:**
- Spec §1 (`DeleteNoteButton` — confirm, hard delete, navigate, error reporting, styling, i18n) → Task 1. ✅
- Spec §2 (toolbar layout — cluster `[SaveIndicator] [Copy] [Delete]`, `initialTitle` threaded) → Task 2 (adds the delete button) + Task 3 (removes `☰`, leaving the final cluster). ✅
- Spec §3 (right-panel toggle — collapse `»` in `DocumentPanel`, expand `«` in the editor area, guillemet directions, styling, reused i18n) → Task 3. ✅
- Spec §4 (data flow — delete: confirm → `notesApi.delete` → `router.push('/notes')`; panel toggle via `useDocPanel`) → Task 1 (delete) + Task 3 (toggle). ✅
- Spec §5 (error handling — transient inline notice; cancelled confirm is a no-op) → Task 1 (`onError` + the cancelled-confirm test) + Task 2 (`deleteError` state, auto-dismiss, notice). ✅
- Spec Testing section → Task 1 (`DeleteNoteButton` unit tests), Task 3 (`DocumentPanel` collapse test), Task 4 (coverage gate). ✅

**Placeholder scan:** No TBD/TODO. Step 1c of Task 3 ("replace every `render(wrap(<DocumentPanel editor={EXPR} />))` call with `renderPanel(EXPR)`") is a precise mechanical transform over a named, bounded set of 10 call sites — not a vague placeholder.

**Type consistency:** `DeleteNoteButton` props `{ noteId: string; noteTitle: string; onError: (message: string) => void }` (Task 1) match the render in Task 2 (`noteId={noteId} noteTitle={initialTitle} onError={setDeleteError}`, where `setDeleteError` is `(s: string | null) => void` — assignable to `(message: string) => void` at the call site). `initialTitle` is typed `string` on both `NoteEditor`'s `Props` (pre-existing) and `CollaborativeEditor` (added in Task 2). `DocumentPanel`'s `onCollapse: () => void` (Task 3) matches the `togglePanel` passed by `CollaborativeEditor` and the `() => void` helper default in the test. `notesApi.delete(id) → Promise<{ deleted: true }>` and `ApiError` are consumed as defined in `api-client.ts`.
