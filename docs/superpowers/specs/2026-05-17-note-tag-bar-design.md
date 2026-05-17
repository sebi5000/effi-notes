# Note Tag Bar — view, add, and remove a note's tags

**Date:** 2026-05-17
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` note editor (`NoteEditor`, a new `TagBar`), `NotesShell`

## Context

Tags exist in the data model (`Tag`, `NoteTag`) and in the command-bar search
(`#tag`), but there is **no UI to view, add, or remove the tags on a note**.
A note's tags can only change through the `PATCH /api/notes/[id]` API, which
nothing in the UI calls for this purpose. New tags can only be created via
`POST /api/tags`, which also has no UI caller.

The backend is complete: `GET /api/tags` lists all tags, `POST /api/tags`
creates one (idempotent — returns the existing tag if the name matches), and
`PATCH /api/notes/[id]` accepts a `tagIds` array that replaces the note's
tags. `NoteDetail.tags` already carries `{ id, name, color }`.

## Problem

A user cannot see which tags a note has, cannot add a tag to a note, cannot
remove one, and cannot create a tag at all from the UI.

## Goals

1. The note editor shows the current note's tags.
2. The user can add a tag to a note — picking an existing tag or creating a
   new one inline.
3. The user can remove a tag from a note.
4. The tag UI sits between the editor's meta-bar (save state / copy / delete)
   and the editing surface.

## Decisions (resolved during brainstorming)

- **A `TagBar` component** rendered inside `CollaborativeEditor`, directly
  after the meta-bar `<div>` and before `<EditorContent>` — the placement the
  user asked for.
- **Frontend only.** `GET`/`POST /api/tags` and `PATCH /api/notes/[id]`
  (`tagIds`) already do everything. No schema, migration, or new endpoint.
- **The chip ✕ unlinks the tag from the note**, it does not delete the tag
  globally. A note's tag set is edited by `PATCH`-ing the full `tagIds` array.
- **Adding a tag** is an autocomplete over the existing tag dictionary
  (reusing `filterTags` from `command.ts`); when the typed name matches no
  tag, a "Create '<name>'" action makes one. `POST /api/tags` is idempotent,
  so a create that races an existing name is harmless.
- **New tags get a colour auto-assigned** deterministically from the tag name
  (a hash into a small brand palette). No colour picker in v1. The same
  helper renders a chip's colour when `Tag.color` is null, so old colourless
  tags still look consistent.
- **The bar is interactive in the editor; the server enforces access.**
  Editing tags is a note `PATCH` (needs `EDIT`). A view-only collaborator who
  tries gets an inline 403 message. Pre-disabling is a non-goal — the editor
  does not currently expose the resolved access level to the client.
- **No ADR** — a self-contained UI feature, no architectural decision.

## Non-goals

- A global tag-management screen (rename / delete tags everywhere).
- A tag colour picker.
- A tag-hierarchy management UI (nested `#a#b` names stay a naming
  convention).
- Any change to the `#`-prefixed command-bar tag search.
- Tag chips back on the sidebar note rows (removed in the two-pane work; not
  reinstated here).

## Design

### 1. `tagColor` helper — `apps/web/src/lib/notes/tag-color.ts` (new)

```ts
const TAG_PALETTE = [
  '#C26A20', '#7C3F00', '#4B5066', '#2F6F4F', '#A03A2B', '#5A4B8A', '#9B6A2F', '#356680',
] as const;

/** Deterministic chip colour for a tag name — stable across renders/sessions. */
export const tagColor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length] ?? TAG_PALETTE[0];
};
```

Pure, unit-tested. Used (a) when creating a new tag (`color: tagColor(name)`)
and (b) as the chip-colour fallback when `tag.color` is `null`.

### 2. `TagBar` component — `apps/web/src/components/notes/Editor/TagBar.tsx` (new)

A `'use client'` component. Props:
```ts
type TagBarProps = {
  tags: ReadonlyArray<TagItem>;          // the note's current tags
  allTags: ReadonlyArray<TagItem>;       // full tag dictionary, for autocomplete
  onChange: (tagIds: string[]) => Promise<void>;   // replace the note's tags
  onCreateTag: (name: string) => Promise<TagItem>; // create (idempotent) a tag
};
```

Renders:
- A horizontal row of **chips**, one per `tags` entry: the tag name, a colour
  dot/background from `tag.color ?? tagColor(tag.name)`, and a ✕ button
  (`aria-label` "remove tag …") that calls
  `onChange(tags.map(t => t.id).filter(id => id !== removed))`.
- A trailing "**＋ Tag**" button. Clicking it reveals a text `<input>` with an
  autocomplete dropdown:
  - Matches come from `filterTags(allTags, typed)` (imported from
    `command.ts`), minus tags already on the note.
  - Picking a match → `onChange([...currentIds, picked.id])`.
  - When the trimmed input is non-empty and no tag has that exact name → a
    "Create '<name>'" row → `const t = await onCreateTag(name)` then
    `onChange([...currentIds, t.id])`.
  - Enter selects the first match (or the create row); Escape closes the
    input. Mirrors the `CommandBar` `#tag` interaction.
- A failed `onChange` (e.g. a 403 for a view-only user) surfaces as a small
  inline `role="alert"` message, auto-dismissed — consistent with the
  editor's existing upload/delete error notices.

### 3. Placement & wiring

`apps/web/src/components/notes/Editor/NoteEditor.tsx` — `NoteEditor`'s `Props`
and the inner `CollaborativeEditor`'s props gain `noteTags`, `allTags`,
`onTagsChange`, `onCreateTag`; `NoteEditor` threads them to
`<CollaborativeEditor>`, which renders `<TagBar tags={noteTags}
allTags={allTags} onChange={onTagsChange} onCreateTag={onCreateTag} />`
immediately after the meta-bar `<div className="…border-b pb-2">` and before
the `<EditorContent>` (the transient upload/delete error alerts keep their
current position below the TagBar).

`apps/web/src/components/notes/NotesShell.tsx`:
- `handleSetNoteTags(tagIds: string[])` — `await notesApi.patch(noteDetail.id,
  { tagIds })`; the `PATCH` returns the updated `NoteDetail`; set
  `noteDetail` to it and update the matching row in the `notes` list state so
  the sidebar stays consistent. Throws on failure so `TagBar` shows the error.
- `handleCreateTag(name: string)` — `const tag = await tagsApi.create({ name,
  color: tagColor(name) })`; merge `tag` into the `tags` dictionary state (so
  later autocompletes see it); return `tag`.
- Pass `noteTags={noteDetail.tags}`, `allTags={tags}`,
  `onTagsChange={handleSetNoteTags}`, `onCreateTag={handleCreateTag}` to
  `<NoteEditor>`.

`tagsApi.create` and `notesApi.patch` already exist in `api-client.ts`. The
note's tags are live state in `NotesShell` (`noteDetail.tags`), so the bar
re-renders whenever they change. No type or schema change — `NoteDetail.tags`
and `TagItem` already have the needed shape.

### 4. i18n

A new `notes.tagBar` namespace in **both** `apps/web/messages/de.json` and
`en.json` with identical keys: `addTag`, `removeTag`, `createTag` (with a
`{name}` placeholder), `placeholder`, `noMatches`.

## Files

| File | Change |
|------|--------|
| `apps/web/src/lib/notes/tag-color.ts` | **new** — `tagColor(name)` |
| `apps/web/src/lib/notes/tag-color.test.ts` | **new** — unit tests |
| `apps/web/src/components/notes/Editor/TagBar.tsx` | **new** — the tag bar |
| `apps/web/src/components/notes/Editor/TagBar.test.tsx` | **new** — component tests |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | thread tag props; render `<TagBar>` after the meta-bar |
| `apps/web/src/components/notes/NotesShell.tsx` | `handleSetNoteTags`, `handleCreateTag`; pass tag props to `<NoteEditor>` |
| `apps/web/messages/{de,en}.json` | `notes.tagBar` keys |
| `vitest.config.ts` | coverage `include` for the new files if not glob-covered |

## Testing

- **`tagColor`** — unit: deterministic (same name → same colour), always a
  palette hex, handles an empty string.
- **`TagBar`** — component tests (jsdom + testing-library): renders a chip per
  tag; the ✕ calls `onChange` without that id; "＋ Tag" reveals the input;
  picking an autocomplete match calls `onChange` with the added id; typing a
  new name shows "Create '<name>'" and triggers `onCreateTag` then `onChange`;
  a rejected `onChange` shows the inline error. `onChange`/`onCreateTag` are
  injected spies.
- **`NoteEditor`** — the `TagBar` renders between the meta-bar and the editor
  content (a light structural assertion; the existing editor tests stay
  green).

## Risks

- **`PATCH` replaces the whole tag set.** Two users editing the same note's
  tags concurrently → last-write-wins on the tag set. Acceptable: tag edits
  are rare and low-stakes, and the note body's CRDT is unaffected.
- **View-only collaborator.** The bar is interactive and a tag edit 403s for
  a viewer. Surfaced as an inline error rather than pre-disabled — accepted,
  documented above; a follow-up could thread the access level to the client.
- **New-tag colour collisions.** Two different names can hash to the same
  palette colour. Harmless — colour is decoration, the name disambiguates.
