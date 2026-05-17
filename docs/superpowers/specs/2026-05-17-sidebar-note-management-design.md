# Sidebar Note Management — add, auto-title, rename, duplicate

**Date:** 2026-05-17
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `packages/db` schema, `apps/web` notes sidebar / editor / pages / API

## Context

The notes UI has no way to **create** a note — the `POST /api/notes` endpoint
exists but nothing in the sidebar calls it. There is also no **duplicate**
action. While diagnosing a `403` reported on `/api/collab/[noteId]`, a second
issue surfaced: the server-rendered notes pages bypass the sharing model
introduced in ADR 0026.

The `403` itself is correct behaviour — the dev login (`test@example.invalid`)
authored none of the seed notes and holds no shares — but the
server-component pages still render any note regardless of access.

## Problem

1. **No create.** A user cannot make a new note from the UI.
2. **No duplicate.** A user cannot copy an existing note.
3. **RSC page leak.** `app/notes/page.tsx` server-renders the top-50 of **all**
   notes' titles into the sidebar; `app/notes/[noteId]/page.tsx` loads **any**
   note by id with no access check and server-renders its title and full body.
   The REST API enforces ADR-0026 access; these pages do not.

## Goals

1. A **+ button** in the sidebar creates a new note and opens it in the editor.
2. A new note has no user-given title; its title **auto-follows the first
   heading** of its body as the user writes.
3. A note can be **renamed from the sidebar**, which **pins** the title
   (auto-titling stops for that note).
4. A **duplicate** action copies a note in full — body, tags, folder, and a
   **deep copy of its embedded image/PDF assets** — and opens the copy.
5. The server-rendered notes pages **enforce ADR-0026 access** like the API.

## Decisions (resolved during brainstorming)

- **Auto-titling runs client-side, in the editor.** `NoteEditor` already
  derives the document outline (`doc-outline.ts`); when the first heading
  changes it `PATCH`es the note title. The server-side alternative (derive in
  `PUT /api/notes/[id]/body`) was rejected — during live editing the body is a
  CRDT synced through the worker, so that route would lag badly.
- **A note carries one bit of title state: `Note.titleManuallySet`.** Auto-
  titling runs only while it is `false`. A sidebar rename sets it `true`,
  permanently pinning the title. Without this bit a manual rename would be
  clobbered by the next heading edit.
- **Duplicate deep-copies assets.** The copy gets its own `Asset` rows
  (including `previewImage`/`extractedText`, so a duplicated PDF needs no
  re-extraction) and its body is rewritten so asset references point at the
  new ids. The copy is fully independent of the original — it does not rely on
  the unsupported cross-note asset reuse.
- **Duplicate is a dedicated endpoint** (`POST /api/notes/[id]/duplicate`),
  not client-side `get` + `create`, because the asset deep-copy and body
  rewrite must be one server-side transaction.
- **Existing notes are backfilled `titleManuallySet = true`** so the migration
  never silently rewrites a human-given title; only notes created *after* this
  feature auto-title.
- **No ADR.** This is feature work within the ADR-0026 model; it introduces no
  cross-cutting architectural decision.

## Non-goals

- Trash / restore / archive UI for notes (the API's soft-delete is untouched).
- Multi-select or bulk actions.
- Drag-and-drop of a note between folders.
- Undo for delete or duplicate.
- A delete-note action in the sidebar (not requested; out of scope).
- Any change to the collaboration / CRDT model.
- Re-seeding. The 8 seed notes + seed folders are **deleted** as a one-off dev
  step (see §7) — they are owner-locked and invisible to the dev login.

## Design

### 1. Schema — `Note.titleManuallySet`

Add to the `Note` model in `packages/db/prisma/schema.prisma`:
```prisma
  titleManuallySet Boolean @default(false)
```
Migration (additive, zero-downtime): add the column with default `false`, then
backfill every pre-existing row to `true`:
```sql
ALTER TABLE "Note" ADD COLUMN "titleManuallySet" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Note" SET "titleManuallySet" = true;
```
New rows insert `false` from the default; existing rows keep their titles.

### 2. Close the RSC page leak

Both pages already resolve the session via `auth()`; they gain access
filtering using the existing engine (`apps/web/src/lib/notes/access.ts`):

- **`app/notes/page.tsx`** — compute `listAccessibleScope(session.user.id)`;
  the `note.findMany` `where` gains the access predicate
  (`authorId = me OR folderId ∈ accessibleFolderIds OR id ∈ sharedNoteIds`,
  AND-ed with the existing `archivedAt: null`); the `folder.findMany` filters
  to `id ∈ accessibleFolderIds`.
- **`app/notes/[noteId]/page.tsx`** — same filtering for the `initialNotes`
  list and folders; additionally, after loading the target `note`, call
  `resolveNoteAccess(session.user.id, noteId)` and `notFound()` when it is
  `null` (a note that exists but is inaccessible is indistinguishable from a
  missing one — consistent with the REST 404/403 split: the page has no body
  to return, so 404 is the only sensible page outcome).

This mirrors `GET /api/notes` and `GET /api/notes/[id]`; the engine is reused,
no access logic is duplicated.

### 3. Add note

- **`NotesShell`** gains a `noteMutations` object — `{ onCreate, onRename,
  onDuplicate }` — built with `useCallback`, passed to `Sidebar` alongside the
  existing `folderMutations`.
- `onCreate`: `notesApi.create({ title: DEFAULT_NOTE_TITLE, ...(folderId ?
  { folderId } : {}) })` — `folderId` is `NotesShell`'s currently-resolved
  filter folder (or omitted for root). `DEFAULT_NOTE_TITLE` is the constant
  `'Neue Notiz'`. On success, `router.push('/notes/<newId>')` to open it.
- **`Sidebar`** renders a `+` button next to the "Notizen" heading, mirroring
  the existing folder `+` button (same styling, an `aria-label` from i18n).
  It calls `noteMutations.onCreate()`.
- `POST /api/notes` already creates with `titleManuallySet` defaulting to
  `false` — a new note auto-titles. No API change for create.

### 4. Auto-title from the first heading

In `NoteEditor`:
- The component receives the note's `titleManuallySet` (added to `NoteDetail`,
  threaded through `NotesShell` → `NoteEditor` props).
- On document change, derive the first heading via the existing
  `doc-outline.ts` outline (`outline[0]?.text`). Debounce with the existing
  `debounce.ts` util (~600 ms).
- When the derived heading is non-empty, differs from the current title, and
  `titleManuallySet === false`: `notesApi.patch(noteId, { title })`.
- `NoteEditor` calls an `onTitleChange(title)` prop so `NotesShell` updates the
  rendered `<h1>` and the matching row in its `notes` list state — no reload.
- No heading → the title stays `DEFAULT_NOTE_TITLE`.

### 5. Sidebar rename

- Note rows in `Sidebar` gain an inline rename, matching the folder-row rename
  interaction: a hover affordance reveals a rename control; activating it
  swaps the row label for a text `<input>` pre-filled with the title; Enter
  commits, Escape cancels.
- Commit calls `noteMutations.onRename(id, title)` →
  `notesApi.patch(id, { title, titleManuallySet: true })`.
- `patchNoteSchema` (`apps/web/src/lib/api/schemas.ts`) gains an optional
  `titleManuallySet: boolean`; the `PATCH /api/notes/[id]` handler writes it
  through when present (EDIT access already enforced).

### 6. Duplicate

**Endpoint — `POST /api/notes/[id]/duplicate`** (`apps/web/src/app/api/notes/[id]/duplicate/route.ts`, new):
- `requireSession`; load the source note (`findUnique`) → `404` if missing;
  `resolveNoteAccess(user.id, id)` → `403` if `null` (VIEW is enough to copy).
- In one `prisma.$transaction`:
  1. Create the new note: `authorId = user.id`, `title = "${source.title} (Kopie)"`,
     `titleManuallySet = true` (the "(Kopie)" marker must not be overwritten by
     auto-titling), `folderId = source.folderId`, `body = source.body`
     (rewritten below).
  2. For every `Asset` with `noteId = source.id`, create a copy: a new row with
     `noteId = newNote.id`, `authorId = user.id`, and every content field
     copied (`data`, `contentType`, `kind`, `filename`, `caption`,
     `extractedText`, `previewImage`, `previewContentType`, `pageCount`).
     Collect an `oldAssetId → newAssetId` map.
  3. Rewrite the new note's `body`: for each map entry, replace every
     occurrence of the old id with the new id (asset ids are unique cuids, so a
     plain string replace is safe and catches both `/api/assets/<id>` image
     URLs and `assetId` attributes); `note.update` the rewritten body.
  4. Copy `NoteTag` rows for the new note.
- `recordAudit({ action: 'notes.duplicated', actorId: user.id, subject: newNote.id, metadata: { sourceId: id } })`.
- Respond `201` with the new note as a `NoteListItem`.
- **`notesApi.duplicate(id)`** added to `api-client.ts`.

**Sidebar** — note rows gain a hover "duplicate" button (alongside rename).
It calls `noteMutations.onDuplicate(id)` → `notesApi.duplicate(id)` → opens the
copy via `router.push`.

### 7. Seed-data cleanup (one-off)

A first plan step deletes the 8 seed notes and the seed folders (a small
script using the Prisma client). Cascades remove the seed notes' assets, tags
links, history, and shares. Seed `Tag` rows are global and harmless — left in
place. This is a dev-environment data step, not a code deliverable.

## Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `Note.titleManuallySet` |
| `packages/db/prisma/migrations/<new>/migration.sql` | additive column + backfill existing rows to `true` |
| `apps/web/src/lib/api/schemas.ts` | `NoteDetail.titleManuallySet`; `patchNoteSchema` += optional `titleManuallySet` |
| `apps/web/src/app/api/notes/[id]/route.ts` | GET `noteSelect`/`toDetail` += `titleManuallySet`; PATCH writes `titleManuallySet` |
| `apps/web/src/app/api/notes/[id]/duplicate/route.ts` | **new** — the duplicate endpoint |
| `apps/web/src/app/notes/page.tsx` | access-filter notes + folders |
| `apps/web/src/app/notes/[noteId]/page.tsx` | access-filter list + folders; `resolveNoteAccess` → `notFound()` |
| `apps/web/src/lib/notes/api-client.ts` | `notesApi.duplicate` |
| `apps/web/src/components/notes/NotesShell.tsx` | `noteMutations` (create/rename/duplicate); thread `titleManuallySet` + `onTitleChange` |
| `apps/web/src/components/notes/Sidebar/index.tsx` | `+` add button; note-row rename + duplicate affordances; `noteMutations` prop |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | auto-title from first heading |
| `apps/web/messages/{de,en}.json` | keys: add-note, rename-note, duplicate-note |
| `vitest.config.ts` | coverage `include` for the new duplicate route |

## Testing

Integration tests hit a real Postgres (per CLAUDE.md); the ≥ 90 % / ≥ 80 %
coverage gate applies.

- **Duplicate endpoint** — a duplicate is owned by the caller, titled
  `"… (Kopie)"`, `titleManuallySet = true`, in the source's folder; tags are
  copied; every source `Asset` has an independent copy under the new note;
  the new body references the **new** asset ids, not the old ones; `VIEW`
  access suffices and an unrelated user gets `403`; a missing id gets `404`;
  an audit row is written.
- **PATCH `titleManuallySet`** — the schema accepts it and the handler
  persists it.
- **RSC pages** — invoking each page function with a mocked `auth()` session
  and a real DB: a user sees only accessible notes/folders; `[noteId]` calls
  `notFound()` for a note the user cannot access; an owner/sharee renders
  normally.
- **Sidebar** — the `+` button calls `onCreate`; a note row's rename commits
  via `onRename` with `titleManuallySet: true`; the duplicate button calls
  `onDuplicate`.
- **Auto-title** — `NoteEditor` (or an extracted pure helper) derives the
  first heading and only emits a title change when `titleManuallySet` is
  `false`.
- New coverage-gated files are added to `vitest.config.ts`.

## Risks

- **Auto-title vs. collaboration.** Multiple editors each derive and `PATCH`
  the title; all converge from the same CRDT state, so the title converges
  too. Last-write-wins is acceptable for a title.
- **Body rewrite false positives.** The duplicate rewrites the body by
  replacing old asset-id substrings. Asset ids are unique 25-char cuids;
  a collision with unrelated body text is implausible. Accepted.
- **Existing-row backfill.** The migration sets every current note
  `titleManuallySet = true`. Correct for human-titled notes; the dev DB's
  seed notes are deleted in §7 regardless.
- **RSC `notFound()` vs. REST `403`.** The page returns `404` where the API
  returns `403`. Intentional: a page cannot render a body it must not show,
  and a 404 page is the standard Next.js outcome — no information the REST
  layer doesn't already gate.
