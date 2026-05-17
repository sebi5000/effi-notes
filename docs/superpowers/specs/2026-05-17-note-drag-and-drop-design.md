# Note Drag-and-Drop — file & move notes between folders

**Date:** 2026-05-17
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` notes sidebar (`Sidebar`, `FolderTree`, `NotesShell`)

## Context

The sidebar can drag-and-drop **folders** (reorder / reparent) — a hand-rolled
HTML5 DnD in `FolderTree.tsx` using the MIME type `application/x-effi-folder`,
persisted via `PATCH /api/folders/reorder`. **Notes** cannot be dragged at all:
a note's folder can only change through the note-detail `PATCH` API, which the
UI never calls for this purpose.

`PATCH /api/notes/[id]` already accepts a nullable `folderId` and already
enforces `EDIT` access on the target folder (ADR 0026). So moving a note is a
solved server problem — this feature is purely the missing sidebar gesture.

## Problem

A user cannot file a note into a folder, move it between folders, or take it
out of a folder, without opening the note and there is no UI for it at all.
Drag-and-drop is the expected gesture and already exists for folders.

## Goals

1. A note row in the sidebar can be **dragged**.
2. Dropping a note on a **folder** moves it into that folder (`folderId` = that
   folder) — this both files an unfiled note and moves a note between folders.
3. Dropping a note on the folder tree's **root area** removes it from its
   folder (`folderId` = `null`).
4. The notes list reflects the move; a failed move (e.g. no `EDIT` on the
   target folder) shows an error and changes nothing.

## Decisions (resolved during brainstorming)

- **Extend the existing HTML5 DnD**, do not add a drag library. Notes use a
  distinct MIME type `application/x-effi-note`; folder drags keep
  `application/x-effi-folder`. Two systems / a new dependency is rejected.
- **No shared drag-state context.** A folder row detects a note-drag by
  inspecting `dataTransfer.types` during `dragover` (the payload itself is
  only readable on `drop`). Components stay decoupled — `FolderTree` needs no
  knowledge of the notes list's drag state.
- **A note drops onto a whole folder row**, not the before/inside/after zones.
  Those three zones are for folder *reordering*; a note has no position, only
  folder membership. The folder's reorder zones render only during a folder
  drag and are untouched here.
- **Root drop un-files** the note (`folderId = null`) — confirmed in
  brainstorming.
- **No backend, schema, or migration change.** `PATCH /api/notes/[id]` already
  does everything; access enforcement is already correct.
- **No ADR** — this extends an established pattern with no new architectural
  decision.

## Non-goals

- Reordering notes *within* a folder — notes sort by edit date; there is no
  `Note.position`. Out of scope.
- Multi-note drag / multi-select.
- A keyboard-driven move — folder moves are also drag-only today; note moves
  match that. (Accessibility of the DnD surface is a pre-existing gap, not
  widened or fixed here.)
- Auto-expanding a collapsed folder when a note is dropped into it.
- Any change to the folder reorder DnD behaviour.

## Design

### 1. Shared MIME constants — `apps/web/src/lib/notes/dnd.ts` (new)

```ts
/** dataTransfer MIME for a sidebar folder drag (reorder / reparent). */
export const FOLDER_DND_MIME = 'application/x-effi-folder';
/** dataTransfer MIME for a sidebar note drag (move into / between folders). */
export const NOTE_DND_MIME = 'application/x-effi-note';
```

`FolderTree.tsx` is refactored to import `FOLDER_DND_MIME` from this module
instead of its local `DND_MIME` constant — a small, in-scope cleanup so both
drag kinds are defined in one place.

### 2. Note rows become draggable — `Sidebar/index.tsx`

Each note `<li>` in the `notes.map` render gains:
- `draggable` — true only when `noteMutations` is set and the row is **not**
  being renamed (a draggable element while an inline rename `<input>` is open
  would fight text selection).
- `onDragStart` — `e.dataTransfer.setData(NOTE_DND_MIME, n.id)`;
  `e.dataTransfer.effectAllowed = 'move'`; sets a `draggingNoteId` state.
- `onDragEnd` — clears `draggingNoteId`.
- While `draggingNoteId === n.id`, the row dims (`opacity-50`), mirroring a
  dragged folder row.

The note's select button, rename, duplicate, and eye controls keep working —
a click is not a drag.

### 3. Folder rows accept a note drop — `FolderTree.tsx`

`FolderTree` gains an optional prop:
```ts
onNoteDrop?: (noteId: string, folderId: string | null) => Promise<void>;
```
When it is set, each `FolderRow`'s root element gets note-drop handlers
(separate from the folder reorder DnD):
- `onDragOver` — if `e.dataTransfer.types` includes `NOTE_DND_MIME`:
  `preventDefault()`, `dropEffect = 'move'`, and set a `noteDropTargetId`
  state to this row's id.
- `onDrop` — if the note MIME is present: read `getData(NOTE_DND_MIME)`,
  clear `noteDropTargetId`, and `await onNoteDrop(noteId, row.id)` inside a
  `try/catch` that routes a thrown error to the existing `actionError` line
  (same display the folder reorder uses).
- While `noteDropTargetId === row.id`, the row shows the accent highlight
  already used for a folder "inside" drop (`bg-accent-soft/40 ring-accent`).

`noteDropTargetId` is its own state, independent of the folder-drag
`dropTarget`. During a note drag the folder `draggingId` is `null`, so the
folder reorder `DropZone`s do not render — the two drag kinds never overlap.

### 4. Root drop un-files — `FolderTree.tsx`

The existing `folder-tree-root` element's `onDragOver` / `onDrop` are extended:
when the dragged payload is a note (`NOTE_DND_MIME` in `dataTransfer.types`),
`dragover` sets `noteDropTargetId = '__root__'` and `drop` calls
`onNoteDrop(noteId, null)`. The root area shows its existing ring highlight.

### 5. Move handler — `NotesShell.tsx`

`noteMutations` gains `onMove: (noteId: string, folderId: string | null) => Promise<void>`.
`Sidebar` passes `noteMutations.onMove` down to `FolderTree` as `onNoteDrop`.

`NotesShell` implements `handleMoveNote(noteId, folderId)`:
- Look up the note in the current `notes` state; if its `folderId` already
  equals the target, return without a request (no-op drop onto the same
  folder).
- Otherwise `await notesApi.patch(noteId, { folderId })`, then refresh the
  notes list.
- A failed `PATCH` (`ApiError`, e.g. `403` for no `EDIT` on the target
  folder) propagates — `handleMoveNote` lets it throw so `FolderTree`'s
  `catch` shows it.

The notes-list fetch currently lives inline in a `useEffect` keyed on the
resolved `folderId` / `tagId`. It is extracted into a `refreshNotes`
`useCallback`; the filter `useEffect` calls it, and `handleMoveNote` calls it
after a successful move so the list reflects the new membership.

### Error handling & edge cases

- **No `EDIT` on the target folder** → `PATCH` returns `403` → the error
  surfaces in `FolderTree`'s `actionError` line; nothing moves.
- **Drop onto the note's current folder** → short-circuited as a no-op.
- **Drop into a collapsed folder** → the note moves; if the active filter is
  not that folder the note simply leaves the visible list. No auto-expand.
- **Drag started on a row mid-rename** → drag is disabled while renaming.

## Files

| File | Change |
|------|--------|
| `apps/web/src/lib/notes/dnd.ts` | **new** — `FOLDER_DND_MIME`, `NOTE_DND_MIME` |
| `apps/web/src/components/notes/Sidebar/FolderTree.tsx` | import `FOLDER_DND_MIME`; `onNoteDrop` prop; folder-row + root note-drop handlers; `noteDropTargetId` state |
| `apps/web/src/components/notes/Sidebar/index.tsx` | note `<li>` draggable + `onDragStart`/`onDragEnd`; `draggingNoteId` state; pass `onNoteDrop` to `FolderTree` |
| `apps/web/src/components/notes/NotesShell.tsx` | `noteMutations.onMove` → `handleMoveNote`; extract `refreshNotes` |
| `apps/web/src/components/notes/Sidebar/FolderTree.test.tsx` | note-drop tests |
| `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx` | note-draggable test |

No new i18n keys: a failed move reuses the existing `actionError` display,
which renders the server's error message.

## Testing

jsdom component tests with simulated HTML5 drag events (a stub `dataTransfer`
with `setData`/`getData`/`types`), mirroring the existing `FolderTree.tsx`
folder-DnD tests.

- **`Sidebar`** — a note row is `draggable` when `noteMutations` is set;
  `onDragStart` writes the note id under `NOTE_DND_MIME`; a row mid-rename is
  not draggable.
- **`FolderTree`** — with `onNoteDrop` set: a `dragover` carrying
  `NOTE_DND_MIME` marks a folder row as the drop target; a `drop` on a folder
  row calls `onNoteDrop(noteId, folderId)`; a `drop` on the root area calls
  `onNoteDrop(noteId, null)`; a folder *drag* (folder MIME) still triggers the
  reorder path and not `onNoteDrop`.
- **Move handler** — `handleMoveNote` skips the request when the folder is
  unchanged; otherwise `PATCH`es `{ folderId }` and refreshes; a `PATCH`
  rejection propagates.
- Pre-existing folder-reorder DnD tests and sidebar tests stay green.

## Risks

- **`dragover`/`dragleave` flicker.** Note-drop targeting is driven by
  `dragover` (which fires continuously) setting `noteDropTargetId`, and cleared
  on `drop`/`dragend` — not by per-element `dragleave` — so moving the cursor
  between a row's children does not flicker the highlight.
- **Two drag kinds, one tree.** Folder and note drags are disambiguated purely
  by MIME type; the folder reorder zones render only during a folder drag, the
  note-drop row handlers act only on the note MIME. They cannot both be active.
- **Stale list after a move.** Mitigated by `refreshNotes` after a successful
  `PATCH`; the move is not optimistic, so a failed move leaves the list
  correct with no rollback needed.
