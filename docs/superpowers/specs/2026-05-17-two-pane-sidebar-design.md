# Two-Pane Sidebar — folders beside the notes list

**Date:** 2026-05-17
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` notes sidebar (`Sidebar`, `NotesShell`), `GET /api/notes`, `NoteListItem`

## Context

The sidebar stacks two things vertically: the **folder tree** (`FolderTree` — folders only) and, below it, a flat **"Notizen" list** of the folder/tag-filtered notes. After a note is dragged into a folder, the user wants to *see* it associated with that folder without scrolling past the whole tree.

During brainstorming the user chose a **two-pane** layout (folder tree and notes list side by side) over nesting notes inside the tree rows, and — guided by a Bear screenshot — asked for richer note rows showing a body-preview snippet and a date.

## Problem

The notes list sits below the folder tree, so the relationship between a folder and its notes is not visible at a glance, and a long folder tree pushes the notes list out of view. The note rows also show only a title (plus tag chips), which is thin for scanning.

## Goals

1. The folder tree and the notes list sit **side by side** in the sidebar.
2. Selecting a folder shows that folder's notes in the notes pane (the existing behaviour, just laid out beside the tree).
3. Each note row shows a **note icon**, the **title**, a **body-preview snippet**, and the **last-edited date**.

## Decisions (resolved during brainstorming)

- **Two-pane layout, not notes-nested-in-tree.** The user explicitly chose the
  two-pane option. Notes are not rendered as child rows inside the folder
  tree.
- **Note rows show: icon + title + snippet + date.** No author, no image
  thumbnails — both were offered and declined. (`Note.author`/asset-thumbnail
  data is therefore NOT added.)
- **Keep the existing light "paper" theme.** The reference screenshot is dark
  only because it is Bear's theme; only the layout/card structure is adopted.
- **`NoteListItem` gains exactly one field, `snippet`.** `GET /api/notes`
  reads `Note.body`, derives the snippet server-side, and returns `snippet` —
  not the full `body` — so the list payload stays small.
- **The flat list is kept** (the user said "keep the flat Notizen section") —
  it is repositioned beside the folder tree, not removed.
- **No backend filtering change.** Folder/tag filtering of the notes pane is
  unchanged; only the layout and the row content change.
- **No ADR** — a UI layout change with no cross-cutting architectural
  decision.

## Non-goals

- Image thumbnails in note rows.
- An author on note rows.
- Resizable / draggable pane divider.
- Nesting notes inside the folder-tree rows (the rejected layout).
- A dark theme.
- Any change to the command-bar search (text / `#tag` / `/folder`).
- Changing which notes the API returns or how access is enforced.

## Design

### 1. Two-pane layout

`apps/web/src/components/notes/Sidebar/index.tsx` — the `<aside>` keeps its
header and `<CommandBar>` full-width at the top. Everything below them becomes
a **two-column row** (`flex`), filling the remaining height:

- **Folder pane** (left) — the "Ordner" heading + ＋ button, the inline
  folder-create input, and `<FolderTree>`. Scrolls independently
  (`overflow-y-auto`).
- **Notes pane** (right) — the "Notizen" heading + ＋ button and the notes
  list. Scrolls independently.

The two panes are divided by a thin border (`border-paper-line`). Each pane
gets a sensible min-width so neither collapses.

`apps/web/src/components/notes/NotesShell.tsx` — the outer grid widens the
sidebar column: `grid-cols-[280px_1fr]` → `grid-cols-[480px_1fr]`; the
collapsed state stays `grid-cols-[0px_1fr]`. The `<aside>`'s `min-w-[280px]`
becomes `min-w-[480px]`. Within the 480 px aside (minus `p-4` padding), the
folder pane is ~200 px and the notes pane takes the rest.

The collapse toggle still collapses the whole sidebar — unchanged.

### 2. Folder pane

`<FolderTree>` is rendered unchanged — the folder hierarchy, the reorder
drag-and-drop, and the note-drop targets (a note dragged from the notes pane
onto a folder still moves it; with the panes side by side this is a natural
left-ward drag) all keep working. The folder pane keeps the existing "Ordner"
heading, the ＋ create button, and the inline create input.

### 3. Notes pane — card rows

The notes list keeps its data, drag source behaviour, per-row actions
(rename, duplicate, share-eye), inline rename, and empty/loading states. Only
the row's visible content changes. Each row shows:

- A **note icon** (a 📄-style glyph), distinguishing a note visually — left of
  the title.
- The **title** — may wrap to ~2 lines (`line-clamp-2`), no longer
  single-line-truncated.
- A **preview snippet** — `note.snippet`, gray, clamped to ~2 lines
  (`line-clamp-2`). Omitted when the snippet is empty.
- The **last-edited date** — `note.updatedAt`, formatted with next-intl's
  `useFormatter()` (per CLAUDE.md's i18n rule): a relative time for the last
  few days ("just now", "2 days ago"), otherwise a short absolute date.

The existing tag chips are dropped from the row (the snippet replaces them as
the secondary line; tags remain reachable via the command bar).

### 4. `NoteListItem.snippet`

`apps/web/src/lib/api/schemas.ts` — the `NoteListItem` type gains
`snippet: string`.

`GET /api/notes` (`apps/web/src/app/api/notes/route.ts`) — the `findMany`
`select` adds `body: true`; `toListItem` derives the snippet and the response
object carries `snippet` (the full `body` is never put on the wire):

```ts
const SNIPPET_LEN = 140;
const toSnippet = (body: string): string =>
  body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
```

`toListItem` takes the row's `body`, sets `snippet: toSnippet(n.body)`, and
does **not** include `body` in its returned object.

**Type-change propagation.** `NoteListItem` gaining a required field breaks
every builder; each is updated to supply `snippet`:
- `GET /api/notes` `toListItem` (above).
- `POST /api/notes` — the created note's `select` adds `body`; the response
  item gets `snippet: toSnippet(created.body)` (a new note's body is `''` →
  empty snippet).
- `POST /api/notes/[id]/duplicate` — its `toListItem` returns
  `snippet: toSnippet(source.body)` (it already loads `source.body`).
- The RSC pages `app/notes/page.tsx` and `app/notes/[noteId]/page.tsx` — their
  `note.findMany` `select` adds `body: true`; each `initialNotes` item gets
  `snippet` from a shared `toSnippet` helper.
- Test fixtures / any other `NoteListItem` literal — `snippet: ''` or a real
  value.

To keep `toSnippet` DRY across the route handlers and the RSC pages, it is
exported from a small shared module
`apps/web/src/lib/notes/snippet.ts`.

### 5. Behaviour (unchanged underneath)

Selecting a folder in the folder pane still drives the notes pane through the
existing command-bar/`?q=` filter resolution in `NotesShell` — the data flow
is untouched, only its on-screen placement changes. No folder selected → the
notes pane shows all notes. The command bar (text / `#tag` / `/folder`) is
unchanged.

## Files

| File | Change |
|------|--------|
| `apps/web/src/lib/notes/snippet.ts` | **new** — `toSnippet(body)` helper |
| `apps/web/src/lib/api/schemas.ts` | `NoteListItem` gains `snippet: string` |
| `apps/web/src/app/api/notes/route.ts` | list + create: select `body`, set `snippet` via `toSnippet` |
| `apps/web/src/app/api/notes/[id]/duplicate/route.ts` | response item sets `snippet` |
| `apps/web/src/app/notes/page.tsx` | `initialNotes` items get `snippet` |
| `apps/web/src/app/notes/[noteId]/page.tsx` | `initialNotes` items get `snippet` |
| `apps/web/src/components/notes/NotesShell.tsx` | widen the sidebar grid column to `480px` |
| `apps/web/src/components/notes/Sidebar/index.tsx` | two-pane layout; card-style note rows (icon, title, snippet, date) |
| `apps/web/messages/{de,en}.json` | a folder-pane heading key if not already present |
| `apps/web/src/lib/notes/snippet.test.ts` | **new** — `toSnippet` unit tests |
| `apps/web/src/app/api/notes/route.test.ts` | assert `snippet` on list items |
| `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx` | two-pane structure + card row content |
| `vitest.config.ts` | coverage `include` for `snippet.ts` if not glob-covered |

## Testing

- **`toSnippet`** — unit tests: collapses whitespace/newlines, trims, caps at
  the max length, empty body → `''`.
- **`GET /api/notes`** — a list item carries a `snippet` derived from the
  note's body and does not carry the full `body`.
- **Sidebar** — the folder pane and notes pane render side by side; a note row
  shows the title, the snippet, and a date; the pre-existing note-mutation,
  drag, and rename tests stay green.
- The RSC page tests and duplicate-route tests stay green after the
  `snippet` propagation.

## Risks

- **Selecting `body` for the list query.** The list `findMany` now reads each
  note's `body` to derive the snippet. Note bodies are plain-text markdown,
  typically a few KB; the read is DB-local and the full body never reaches the
  client. If a deployment accumulates very large notes and the list query
  shows up in traces, the escape hatch is a raw `LEFT(body, N)` projection
  (the search route already uses that pattern). Accepted for now.
- **Sidebar width.** Widening to 480 px takes ~200 px from the editor. On a
  typical viewport this is comfortable; on a very narrow window the user can
  collapse the sidebar with the existing toggle.
- **Two scroll regions.** Folder pane and notes pane scroll independently; a
  very long folder tree no longer pushes the notes list off-screen — which is
  the point.
