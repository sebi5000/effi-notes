# Notes — folder-aware search & persistent filter

**Date:** 2026-05-15
**Status:** Approved — ready for implementation plan
**Area:** `apps/web` notes UI (sidebar, command bar, notes list)

## Problem

When a folder is selected, the sidebar correctly lists only that folder's
notes. But selecting a note from that list resets the sidebar to **all**
notes — the folder focus is lost.

Root cause: filter state (`folderId`, `tagId`) lives in `NotesShell`
component state. Opening a note runs `router.push('/notes/[noteId]')`,
which renders a **new** `NotesShell` (a different route segment). The new
instance defaults `folderId` to `null` and receives the global top-50 as
`initialNotes`, so the filter silently disappears.

## Goals

1. The command bar can search folders with a leading `/`, exactly as a
   leading `#` searches tags.
2. Selecting a folder by mouse writes its path into the search field
   (e.g. selecting "Clients" → field shows `/Clients`). Clearing the
   search field restores the full notes list.
3. Folders and tags can be nested, and search reflects the nesting:
   `#discovery#new#01` for tags, `/Clients/Intech/Support` for folders.
4. The "Notizen" list is sorted by edit date — most recently edited first.

## Non-goals

- A full tag-management UI (creating/renaming/deleting tags). Requirement 3
  only requires nested tag *names* to be **valid** and **searchable**.
- A real parent/child hierarchy for tags (decided: naming convention).
- Recursive folder filtering — `/Clients` shows notes **directly** in
  "Clients", not its subfolders (decided: direct folder only).
- Server-side pre-resolution of the filter. The client reconciles the list;
  while a non-empty `q` is pending on mount, the list waits rather than
  flashing the global list.

## Design

### 1. Single query grammar — `parseCommand`

`parseCommand(raw)` in `CommandBar.tsx` is extended to four modes (today
it has three). It stays a pure, unit-tested function:

| Input            | Result                                      | Drives          |
|------------------|---------------------------------------------|-----------------|
| `''`             | `{ kind: 'empty' }`                          | all notes       |
| `#discovery#new` | `{ kind: 'tag', needle: 'discovery#new' }`   | tag filter      |
| `/Clients/Intech`| `{ kind: 'folder', path: 'Clients/Intech' }` | folder filter   |
| `quarterly plan` | `{ kind: 'text', q: 'quarterly plan' }`      | full-text search|

The `needle` / `path` keep the full nested string. Path segments are split
on `/` and trimmed; empty segments (e.g. trailing slash) are dropped.

### 2. URL-driven filter (`?q=`)

The filter string is stored in the URL search param `q`. This is the single
source of truth and survives navigation between `/notes` and
`/notes/[noteId]`, fixing the bug.

`NotesShell`:
- Reads `q` via `useSearchParams()`.
- Parses `q` and fetches `/api/notes` for the matching filter:
  - `empty` → `notesApi.list({})` (all notes)
  - `tag` → resolve `needle` to a tag id (exact, case-insensitive name
    match) → `notesApi.list({ tagId })`. No match → empty list.
  - `folder` → resolve path to a folder id → `notesApi.list({ folderId })`.
    No match → empty list.
  - `text` → `notesApi.list({ q })`.
- The command-bar input is **controlled** by `q`. Editing it calls
  `router.replace('/notes/...?q=<encoded>')` (replace, not push, so typing
  does not spam browser history).
- Opening a note calls `router.push('/notes/[id]?q=<current q>')` so the
  filter is preserved across the navigation.
- On mount with a non-empty `q`, the list shows a pending state until the
  first fetch resolves — it never flashes the unfiltered `initialNotes`.

`selectedFolderId` / `selectedTagId` (used to highlight the tree row and the
active tag) become **derived** from parsing `q`, not separate state.

### 3. Folder search with `/`

`CommandBar` receives the `folders` list as a prop. In `folder` mode it
renders a folder-suggestion dropdown that mirrors the existing `#tag`
dropdown. Selecting a suggestion (click or Enter on the first match) sets
`q = '/' + <full folder path>`.

New pure helpers in `lib/notes/folder-tree.ts`:
- `folderPath(folders, folderId): string` — `'Clients/Intech/Support'`.
- `resolveFolderPath(folders, path): string | null` — walks the tree from
  the root by case-insensitive name match per segment; returns the folder
  id or `null`. Direct match only.
- `filterFolderPaths(folders, needle): FolderNode[]` — folders whose path
  prefix- or substring-matches `needle`, prefix matches ranked first
  (parallels `filterTags`).

### 4. Folder/tag selection → search field

- `FolderTree.onSelect` no longer sets a separate `folderId` state. It sets
  `q = '/' + folderPath(folder)`, which flows back through the URL and into
  the controlled command-bar input.
- The standalone "Filter: #tag ×" chip in `Sidebar/index.tsx` is **removed**.
  The search field is the single filter control.
- Selecting a tag from the dropdown fills the field with `#<tagname>`, for
  consistency with folder selection.
- Clearing the field (an explicit `×` button on the input — not relying on
  inconsistent native `type="search"` styling) removes `q` from the URL,
  restoring all notes.

### 5. Nested tags — naming convention

The `Tag` model stays flat (no `parentId`, no migration). The nesting lives
in the tag *name*: a tag named `discovery#new#01` represents the nested
path. The tag-name regex in `createTagSchema` (`apps/web/src/lib/api/schemas.ts`)
is relaxed from `^[\p{L}\p{N}_-]+$` to also allow `#` as an interior level
separator (no leading, trailing, or doubled `#`).

The existing `filterTags` prefix/substring match already makes `#discovery`
surface `discovery#new#01`, so search "reflects the nesting" with no new
tag-search code.

### 6. Notes list sorted by edit date

The `/api/notes` handler and both server pages already use
`orderBy: { updatedAt: 'desc' }`. The real gap is **staleness** — the list
is not re-fetched after edits. The URL-driven re-fetch already runs on every
navigation (NotesShell mounts fresh each time a note is opened), so the
order is refreshed whenever the user opens or switches notes. The explicit
`orderBy` is kept, and `NotesShell` applies a client-side
`updatedAt`-descending sort guard on the fetched list.

## Components & files

| File | Change |
|------|--------|
| `components/notes/Sidebar/CommandBar.tsx` | `parseCommand` 4th mode; `folder` dropdown; controlled `value`/`onChange` props; `folders` prop; explicit clear `×` |
| `components/notes/NotesShell.tsx` | URL-driven `q`; parse → fetch; wire command bar + tree; preserve `q` on note open; sort guard |
| `components/notes/Sidebar/index.tsx` | pass query props through; remove tag chip; derive selected folder/tag from `q` |
| `lib/notes/folder-tree.ts` | add `folderPath`, `resolveFolderPath`, `filterFolderPaths` |
| `lib/api/schemas.ts` | relax tag-name regex to allow interior `#` |
| `messages/en.json`, `messages/de.json` | update `commandBar` placeholder/hint; add `noFolderMatch`, `clearSearch`; remove now-unused `filterByTag`/`clearTag` |

## Testing

The repo enforces a ≥90 % coverage gate, and tests precede implementation
(TDD).

- **Pure helpers** (`folder-tree.ts`): unit tests for `folderPath`,
  `resolveFolderPath` (hit, miss, case-insensitive, trailing slash),
  `filterFolderPaths` (prefix vs substring ranking).
- **`parseCommand`**: the new `folder` mode plus existing modes.
- **`CommandBar`**: folder-suggestion dropdown, Enter-applies-first,
  controlled value, clear button.
- **`NotesShell` / `Sidebar`**: folder click writes `/path` into the field;
  clearing restores all notes; filter survives opening a note; selected
  folder/tag highlight derived from `q`.

## Risks & mitigations

- **`useSearchParams()` + static rendering** — the notes routes are already
  dynamic (auth gate). If Next requires a Suspense boundary, wrap the
  command-bar subtree.
- **Brief list flash on hard reload of `/notes/[id]?q=…`** — mitigated by
  the pending-state-until-first-fetch rule (non-goal: server pre-resolution).
- **Existing tests** referencing the removed tag chip / old `CommandBar`
  signature must be updated in the same change.
