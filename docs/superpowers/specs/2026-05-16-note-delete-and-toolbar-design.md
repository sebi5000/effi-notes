# Note Delete + Editor Toolbar Repositioning

**Date:** 2026-05-16
**Status:** Approved — ready for implementation plan
**Area:** `apps/web` — note editor components only

## Context

Folders can be deleted from the sidebar; notes cannot be deleted at all from
the UI. The note editor's top toolbar also groups three controls together —
the save indicator, the copy-as-Markdown button, and the right-panel toggle
(`☰`) — and the panel toggle's placement does not match the left sidebar's
collapse/expand affordance.

This sub-project adds a note-delete button and re-arranges the editor toolbar
so the copy/delete actions and the panel toggle are placed deliberately.

## Problem

1. A note can only be removed by deleting its whole folder or via the API —
   there is no per-note delete in the editor.
2. The `☰` panel toggle is bundled with the copy button instead of sitting
   next to the panel it controls, and it is stylistically inconsistent with
   the left sidebar's collapse/expand button.

## Goals

1. A delete-note button in the editor toolbar, beside the copy-Markdown
   button — small and unobtrusive, matching the copy button's styling.
2. Deletion is **hard** (permanent, irreversible) and requires an explicit
   confirmation pop-up before it happens.
3. The right-panel toggle sits next to the right panel and mirrors the left
   sidebar's collapse/expand affordance.

## Non-goals

- Soft delete / archive UI. The note API supports archiving (`DELETE` without
  `?hard=1`), but this sub-project wires only the hard delete. Archive stays
  API-only.
- A delete control in the sidebar note list. The single delete entry point is
  the editor toolbar.
- A reusable themed dialog component. Confirmation uses the native
  `window.confirm()`, consistent with the existing folder-tree delete.
- Per-note ownership/authorization checks. That is a pre-existing API-wide gap
  tracked separately; this sub-project only calls the existing endpoint.
- Any API, database, or schema change. `DELETE /api/notes/[id]?hard=1` and
  `notesApi.delete(id)` already exist.

## Decisions (resolved during brainstorming)

- **Hard delete.** The delete button permanently removes the note row, the
  same as folder deletion. It calls the existing `notesApi.delete(id)` (which
  hits `DELETE /api/notes/[id]?hard=1`). Archive is not exposed in this UI.
- **Native `window.confirm()` confirmation.** Identical mechanism to the
  folder-tree delete (`FolderTree.tsx`). No new dialog component — keeps the
  app consistent and avoids scope.
- **Panel toggle mirrors the left sidebar.** The `☰` button is replaced by a
  guillemet pair (`«` / `»`) styled like the left sidebar's collapse/expand
  buttons.

## Design

### 1. Delete-note button — `DeleteNoteButton.tsx`

A new self-contained client component in
`apps/web/src/components/notes/Editor/`, modelled on `CopyMarkdownButton`.

- **Props:** `noteId: string`, `noteTitle: string`.
- **Behaviour on click:**
  1. `window.confirm()` with a message naming the note title (e.g.
     `Notiz "<title>" löschen?` / `Delete note "<title>"?`).
  2. If cancelled — do nothing.
  3. If confirmed — call `notesApi.delete(noteId)`, then navigate to the note
     index (`router.push('/notes')`).
  4. On `ApiError` (or any failure) — do not navigate; surface a brief,
     auto-dismissing inline error notice, reusing the editor's existing
     transient upload-error notice pattern.
- **Styling:** matches `CopyMarkdownButton` — `text-xs`, muted base colour,
  small, `rounded`. The hover state uses the danger/red colour to signal a
  destructive action. The glyph is matched to the folder-tree delete control
  during implementation.
- **i18n:** new keys under the existing `notes.editorActions` namespace —
  `delete` (button label / `aria-label` / `title`), `confirmDelete` (the
  confirm message, parameterised with the title), and `deleteFailed` (the
  error notice). Added to both `de.json` and `en.json`.

The component owns its own navigation (`useRouter` from `next/navigation`)
and confirmation, so the editor only has to render it with the two props.

### 2. Editor toolbar layout — `NoteEditor.tsx`

In `CollaborativeEditor`, the header strip keeps its right-aligned control
cluster at the editor column's top-right corner. After the change the cluster
is `[SaveIndicator] [CopyMarkdownButton] [DeleteNoteButton]`. The `☰`
panel-toggle button is removed from this cluster (it is replaced per §3).

`CollaborativeEditor` already receives the note title — `NoteEditor`'s
`initialTitle` prop is currently passed through but unused (`_initialTitle`).
It is threaded to `DeleteNoteButton` as `noteTitle` so the confirm message can
name the note. `noteId` is already in scope.

### 3. Right-panel toggle — mirror of the left sidebar

The `☰` button is replaced by a guillemet pair driven by the existing
`useDocPanel` hook (`panelOpen` / `togglePanel`) — no state changes.

- **Panel open:** a collapse button **`»`** is rendered at the top-right of
  `DocumentPanel` (`DocumentPanel.tsx`), styled like the left sidebar's
  in-sidebar collapse button (`h-6 w-6`, `text-muted-foreground/60`,
  `hover:text-foreground`, `rounded text-sm leading-none`). It calls
  `togglePanel`.
- **Panel closed:** an expand button **`«`** is rendered in the editor area,
  `absolute right-3 top-3 z-10`, styled like the left sidebar's expand button
  (`h-7 w-7`, same colour classes). It calls `togglePanel`.
- The guillemet directions mirror the left sidebar: the left sidebar uses `«`
  to collapse (toward the left edge) and `»` to expand; the right panel uses
  `»` to collapse (toward the right edge) and `«` to expand.
- **i18n:** reuses the existing `notes.docPanel.show` / `notes.docPanel.hide`
  keys — no new strings.

`DocumentPanel` gains a way to render and wire its collapse button — it
receives `togglePanel` (and, if needed, the relevant label) from
`CollaborativeEditor`, alongside the `editor` prop it already takes.

### 4. Data flow

- **Delete:** click → `window.confirm` → `notesApi.delete(noteId)` →
  `router.push('/notes')`. On error → inline notice, no navigation.
- **Panel toggle:** click (either guillemet) → `togglePanel()` → `panelOpen`
  flips; `useDocPanel` persists it to localStorage. Open renders the panel
  with its `»`; closed renders the editor-area `«`.

### 5. Error handling

- A delete that fails (`notesApi.delete` throws) shows a brief, dismissible
  inline error message in the editor, consistent with the existing
  upload-error notice (`uploadError`). The user stays on the note.
- A cancelled confirmation is a no-op — no error, no navigation.

## Files

| File | Change |
|------|--------|
| `apps/web/src/components/notes/Editor/DeleteNoteButton.tsx` | **new** — the delete button + confirm + navigation |
| `apps/web/src/components/notes/Editor/DeleteNoteButton.test.tsx` | **new** — unit tests |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | toolbar cluster gains the delete button; `☰` removed; `initialTitle` threaded through; editor-area expand `«` when panel closed |
| `apps/web/src/components/notes/Editor/DocumentPanel.tsx` | renders the collapse `»` button at its top-right |
| `apps/web/src/components/notes/Editor/DocumentPanel.test.tsx` | extended for the collapse button |
| `apps/web/messages/de.json` | new `notes.editorActions` keys (`delete`, `confirmDelete`, `deleteFailed`) |
| `apps/web/messages/en.json` | same new keys |

## Testing

- **`DeleteNoteButton`** — unit tests with `window.confirm`, `notesApi`, and
  `useRouter` mocked:
  - confirmation cancelled → `notesApi.delete` not called, no navigation;
  - confirmation accepted → `notesApi.delete` called with the note id, then
    `router.push('/notes')`;
  - `notesApi.delete` rejects with `ApiError` → error notice shown, no
    navigation.
- **`DocumentPanel`** — extended: the collapse `»` button renders and invokes
  the toggle callback when clicked.
- The `DELETE /api/notes/[id]?hard=1` route already has integration coverage
  (`apps/web/src/app/api/notes/[id]/route.test.ts`); no API test work needed.
- New coverage-gated files (`DeleteNoteButton.tsx`) are tested to the repo's
  ≥ 90 % / ≥ 80 % threshold.

## Risks

- **Accidental permanent loss.** Hard delete is irreversible. Mitigated by the
  mandatory `window.confirm()` naming the note title — the same safeguard
  folder deletion relies on.
- **Navigation race.** Deleting while a body save is in flight: navigating
  away unmounts `CollaborativeEditor`, whose cleanup effect destroys the
  Y.Doc / WebSocket provider. The in-flight save either completes or is
  abandoned harmlessly; the note row is gone regardless. Acceptable.
