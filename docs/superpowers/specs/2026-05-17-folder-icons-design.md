# Folder Icons

**Date:** 2026-05-17
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` notes sidebar (`FolderTree`, new `FolderIcon` /
`FolderIconPicker`), `NotesShell`, the folders API, the `Folder` schema.

## Context

Folders render in the sidebar with no icon at all — a `FolderRow` is an
expand/collapse chevron (or a spacer), the folder name, and a hover cluster of
action buttons. Notes, by contrast, carry a 📄 glyph. Tags carry a colour
(`Tag.color`, with the `tagColor` palette helper). Folders have no visual
identity beyond their name.

The `Folder` model (`packages/db/prisma/schema.prisma`) has no `icon` field.
`PATCH /api/folders/[id]` already exists and is used for rename and reorder; it
enforces `EDIT` access through the notes access module. `POST /api/folders`
creates a folder from a name. No icon library is installed in `apps/web`.

## Problem

A folder has no icon and no way to get one. Users cannot visually distinguish
folders at a glance — every row looks the same but for its text.

## Goals

1. Every folder shows an icon; folders that exist today gain a default one.
2. A user can change a folder's icon by clicking the icon itself.
3. The icon is chosen from a curated set of 24 icons.
4. The chosen icon persists and is enforced server-side (an `EDIT`-level
   change, like rename).

## Decisions (resolved during brainstorming)

- **Icon library: `lucide-react`.** Lucide is shadcn/ui's native icon set
  (shadcn/ui is already in the template stack), MIT-licensed, and
  tree-shakeable through named imports — only the 24 icons we use are bundled.
- **A curated set of 24 icons**, not a searchable view of the full ~1500-icon
  library. The set: `folder`, `folder-open`, `briefcase`, `house`, `user`,
  `users`, `star`, `archive`, `inbox`, `file-text`, `book-open`,
  `graduation-cap`, `code`, `rocket`, `lightbulb`, `calendar`, `list-checks`,
  `heart`, `flag`, `image`, `music`, `wallet`, `globe`, `mail`.
- **The folder's icon is the picker trigger** — clicking the rendered icon
  opens the picker. No extra hover button; the row stays uncluttered.
  Selecting the folder still happens by clicking its name.
- **New folders default to `folder`.** The icon is not chosen at creation
  time; you change it afterward via the picker.
- **The icon column is non-null with a DB default** (`icon String
  @default("folder")`). Every folder always has an icon — no null-handling at
  render. The additive migration backfills existing rows to `"folder"`.
- **Monochrome.** Folder icons inherit the row's text colour; there is no
  colour for folders (unlike tags). A colour is a separate idea, out of scope.
- **The picker popover is hand-rolled** — a small absolutely-positioned panel
  with outside-click and Escape handling. No Radix, no popover dependency;
  consistent with the repo's other hand-rolled interactions (`ShareDialog`,
  the command bar, folder/note DnD). `lucide-react` stays the only new dep.
- **ADR 0027** records adopting `lucide-react` — it is the template's first
  dedicated icon library and a new runtime dependency, and the template is
  deliberate about dependencies (CLAUDE.md hard rule 10).

## Non-goals

- A searchable picker over the full Lucide library.
- Per-folder icon colour, or a colour picker.
- Choosing an icon while creating a folder.
- Icons for notes, tags, or any entity other than folders.
- Custom / uploaded icons.
- A global icon-management or theming screen.

## Design

### 1. Schema & migration

`packages/db/prisma/schema.prisma` — the `Folder` model gains:

```prisma
icon String @default("folder")
```

The migration is additive: a new `TEXT NOT NULL DEFAULT 'folder'` column.
Existing folder rows backfill to `'folder'`. No index needed — `icon` is never
filtered or sorted on. Generated with `prisma migrate dev`; the
`db-migration-reviewer` subagent reviews it. Zero-downtime per the template's
migrator pattern (ADR 0019).

### 2. `folder-icons.ts` — the single source of truth

`apps/web/src/lib/notes/folder-icons.ts` (new):

- `FOLDER_ICONS` — the ordered, readonly array of the 24 icon keys above.
- `DEFAULT_FOLDER_ICON = 'folder'`.
- `folderIconSchema` — a Zod enum built from `FOLDER_ICONS`
  (`z.enum(FOLDER_ICONS)`), exported for the API body validator and the
  `FolderNode` / `PatchFolderInput` schemas.
- `isFolderIcon(value: string): value is FolderIcon` — a narrowing guard used
  by the renderer's fallback.
- `type FolderIcon` — the union of the 24 keys.

Adding or swapping an icon is a one-line edit here; the API, picker, and
renderer all follow.

### 3. `FolderIcon.tsx` — the renderer

`apps/web/src/components/notes/Sidebar/FolderIcon.tsx` (new). A pure,
presentational component. Props: `{ icon: string; className?: string }`.

- A static `Record<FolderIcon, LucideIcon>` maps each key to its `lucide-react`
  component, populated with named imports (`Folder`, `FolderOpen`, `Briefcase`,
  `House`, `User`, `Users`, `Star`, `Archive`, `Inbox`, `FileText`,
  `BookOpen`, `GraduationCap`, `Code`, `Rocket`, `Lightbulb`, `Calendar`,
  `ListChecks`, `Heart`, `Flag`, `Image`, `Music`, `Wallet`, `Globe`, `Mail`).
- If `icon` is not a known key (a legacy or corrupt value), it falls back to
  the `folder` icon — so an out-of-set stored value self-heals visually.
- The Lucide component is rendered `aria-hidden` at the row's text size; the
  accessible name comes from the surrounding control, not the glyph.

### 4. `FolderIconPicker.tsx` — the popover

`apps/web/src/components/notes/Sidebar/FolderIconPicker.tsx` (new). The
hand-rolled popover. Props:

```ts
type FolderIconPickerProps = {
  current: string;                 // the folder's current icon key
  onPick: (icon: FolderIcon) => void;
  onClose: () => void;
};
```

Renders:

- A 6×4 grid of the 24 icons (`FOLDER_ICONS` order), each a `<button>` showing
  the icon via `<FolderIcon>`. Each button's `aria-label` is the localised
  icon name (`notes.folderIcons.names.<key>`). The button matching `current`
  carries a ring to mark the active icon.
- Picking an icon calls `onPick(icon)`. Escape, or a click outside the popover,
  calls `onClose()`.
- Keyboard: focus enters the grid on open; arrow keys move focus across the
  6×4 grid; Enter/Space picks the focused icon; Escape closes and returns focus
  to the trigger. The popover has `role="dialog"` and is labelled by a heading
  (`notes.folderIcons.pickerLabel`).
- The panel is absolutely positioned and anchored to the trigger; it does not
  need to be collision-aware (the sidebar is tall and the grid is small) — it
  renders below the trigger.

### 5. Wiring in `FolderTree.tsx`

`apps/web/src/components/notes/Sidebar/FolderTree.tsx`:

- `FolderRow` renders `<FolderIcon icon={row.icon} />` immediately after the
  chevron/spacer and before the name (the position is empty today).
- When folder mutations are available, the icon is wrapped in a `<button>`
  (the trigger): a subtle ring on hover/focus signals it is interactive;
  `onClick` calls `e.stopPropagation()` (so the row is not selected) and asks
  `FolderTree` to open the picker for this row. When the tree is read-only (no
  mutations — a viewer), the icon renders plain, with no button.
- `FolderTree` holds `pickerFolderId: string | null` — at most one picker open.
  Clicking a different folder's icon moves the picker; Escape / outside-click /
  a pick clears it.
- `FolderMutationHandlers` gains `onSetIcon: (folderId: string, icon:
  FolderIcon) => Promise<void>`. On a pick, `FolderRow` calls it; on rejection,
  the error surfaces through `FolderTree`'s existing `actionError` alert — the
  same channel rename and delete failures use.
- The `FlatFolder` shape produced by `buildFolderTree` carries `icon` through
  from `FolderNode`.

### 6. Wiring in `NotesShell.tsx`

`handleSetFolderIcon(folderId: string, icon: FolderIcon)`:

- Optimistically updates the matching folder in the `folders` state.
- `await foldersApi.patch(folderId, { icon })`.
- On success, reconciles the folder with the returned `FolderNode`.
- On failure, reverts the optimistic update and re-throws so `FolderTree`'s
  `actionError` shows it.

It is added to the `folderMutations` object `NotesShell` passes to `<Sidebar>`,
alongside `onCreate` / `onRename` / `onDelete` / `onReorder`. `Sidebar/index.tsx`
builds an explicit `mutations` object for `<FolderTree>` (it picks fields, not a
spread), so `onSetIcon` must be added to that object too.

### 7. API & types

- `apps/web/src/lib/api/schemas.ts`: `FolderNode` gains `icon: string`.
  Validation is deliberately asymmetric: the **read** schema (`FolderNode`)
  types `icon` as a plain `z.string()`, so a stale out-of-set value still
  parses and reaches `FolderIcon`'s visual fallback rather than failing the
  whole folder-list parse. The **write** path is strict: `PatchFolderInput`
  gains an optional `icon` validated by the `folderIconSchema` enum, so an
  unknown key cannot be written.
- `apps/web/src/app/api/folders/[id]/route.ts`: the `PATCH` body schema accepts
  an optional `icon` validated by `folderIconSchema`. An unknown key fails Zod
  → 400. The route's existing `EDIT` access check is unchanged → a view-only
  collaborator's icon change → 403. The handler writes `icon` when present.
  The `PATCH` response is parsed as a `FolderNode` (lenient `icon`).
- The folders query/serializer (whatever `GET /api/folders` and the `PATCH`
  response use to shape a `FolderNode`) selects and returns `icon`.
- `POST /api/folders` is unchanged — new folders take the schema default.

### 8. i18n

A new `notes.folderIcons` namespace in **both** `apps/web/messages/de.json`
and `apps/web/messages/en.json`, with identical keys:

- `pickerLabel` — the popover's heading / `aria-label`
  ("Change folder icon" / "Ordnersymbol ändern").
- `names.<key>` for each of the 24 icons — the localised icon name used as the
  grid buttons' `aria-label` (e.g. `names.briefcase` → "Briefcase" /
  "Aktentasche"). These 24 entries are the bulk of the i18n work.

### 9. ADR 0027

`docs/adr/0027-lucide-react-icon-library.md` — a short ADR: the template
adopts `lucide-react` as its icon library. Context: folders (and, later, other
UI) need icons; shadcn/ui is already the chosen component layer. Decision:
`lucide-react`, because it is shadcn/ui's native set, MIT-licensed, and
tree-shakeable. Alternatives weighed: Heroicons, Phosphor, hand-rolled SVGs.
Consequences: one new runtime dependency in `apps/web`; future icon needs use
the same library; named imports keep the bundle cost proportional to icons
used.

## Files

| File | Change |
|------|--------|
| `docs/adr/0027-lucide-react-icon-library.md` | **new** — ADR |
| `packages/db/prisma/schema.prisma` | `Folder.icon String @default("folder")` |
| `packages/db/prisma/migrations/<ts>_folder_icon/migration.sql` | **new** — additive column |
| `apps/web/package.json` | add `lucide-react` (version verified via `npm view`) |
| `apps/web/src/lib/notes/folder-icons.ts` | **new** — `FOLDER_ICONS`, `folderIconSchema`, guard |
| `apps/web/src/lib/notes/folder-icons.test.ts` | **new** — unit tests |
| `apps/web/src/components/notes/Sidebar/FolderIcon.tsx` | **new** — key→Lucide renderer |
| `apps/web/src/components/notes/Sidebar/FolderIcon.test.tsx` | **new** — tests |
| `apps/web/src/components/notes/Sidebar/FolderIconPicker.tsx` | **new** — popover grid |
| `apps/web/src/components/notes/Sidebar/FolderIconPicker.test.tsx` | **new** — tests |
| `apps/web/src/components/notes/Sidebar/FolderTree.tsx` | render the icon button; wire the picker; `onSetIcon` |
| `apps/web/src/components/notes/NotesShell.tsx` | `handleSetFolderIcon`; thread into `folderMutations` |
| `apps/web/src/components/notes/Sidebar/index.tsx` | add `onSetIcon` to the `mutations` object built for `<FolderTree>` |
| `apps/web/src/lib/api/schemas.ts` | `FolderNode.icon`, `PatchFolderInput.icon` |
| `apps/web/src/app/api/folders/[id]/route.ts` | `PATCH` accepts `icon` |
| folders query/serializer | select + return `icon` |
| `apps/web/messages/{de,en}.json` | `notes.folderIcons` keys |

## Testing

- **`folder-icons.ts`** — unit: `FOLDER_ICONS` has 24 unique keys;
  `folderIconSchema` accepts a known key and rejects an unknown string;
  `isFolderIcon` narrows correctly; `DEFAULT_FOLDER_ICON` is in the set.
- **`FolderIcon`** — renders the expected Lucide icon for a known key; an
  unknown key falls back to the `folder` icon; passes `className` through.
- **`FolderIconPicker`** — renders 24 buttons; the `current` icon's button is
  marked active; clicking a button calls `onPick` with that key; Escape and an
  outside click call `onClose`; arrow keys move focus across the grid.
- **`FolderTree`** — the icon button renders for a folder; clicking it opens
  the picker (and does not select the folder); picking an icon calls
  `onSetIcon`; only one picker is open at a time. Read-only tree: the icon
  renders without a button.
- **`PATCH /api/folders/[id]`** — integration (real Postgres, separate test
  DB): a valid `icon` updates the folder and is returned; an invalid icon key
  → 400; a view-only collaborator → 403; omitting `icon` leaves it unchanged.
- Pre-existing folder tests stay green; `FolderNode` fixtures gain `icon`.

## Risks

- **A stale / out-of-set persisted icon** (e.g. the curated set changes in a
  future release). Mitigated — `FolderIcon` falls back to `folder` for any key
  not in the map, so an out-of-set value self-heals visually; the API rejects
  out-of-set values on write.
- **Bundle size from a new icon library.** Mitigated — `lucide-react` named
  imports are tree-shaken; only the 24 referenced icons ship. Verified by the
  Turbopack build in the plan's verification step.
- **i18n breadth.** 24 localised icon names per locale is the largest part of
  the change surface. Accepted — proper screen-reader names are worth it, and
  both locale files are kept in lockstep (the `i18n-extractor` subagent
  enforces matching keys).
- **`PATCH` icon races a concurrent rename/reorder.** Each `PATCH` carries only
  the fields it changes; the handler writes `icon` independently of `name` /
  `position`, so an icon change and a rename do not clobber each other.
