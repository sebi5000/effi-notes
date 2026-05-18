# Editor Tables

**Date:** 2026-05-18
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` note editor — `MarkdownExtensions`, a new `TableExtension`,
a new `TableMenu`, `EditorToolbar`.
**Branch:** `feat/editor-tables` (isolated worktree).

## Context

The note editor is Tiptap v3 (`@tiptap/core` 3.23.4) running over a Yjs CRDT.
`buildExtensions` in `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`
assembles the extension list: StarterKit, Link, Typography, TaskList/TaskItem,
the custom Callout / NoteImage / PdfChip nodes, FileHandler, and
Collaboration / CollaborationCaret.

The document's source of truth is the Yjs CRDT, persisted as the note's
`yjsState` snapshot. The `body` column is a plain-text projection
(`editor.getText()`) used for search and snippets. Markdown is only an
**export** format: `CopyMarkdownButton` runs `editor.getHTML()` through the
pure `htmlToMarkdown` helper (`apps/web/src/lib/notes/markdown.ts`), which uses
Turndown with the `turndown-plugin-gfm` plugin — and that plugin already
converts `<table>` elements.

The floating bottom toolbar (`EditorToolbar.tsx`) has heading / list / mark /
blockquote / link controls and a `CalloutMenu` dropdown. Its own comment notes
that tables were "omitted in v1 — ships as a separate Tiptap extension we
haven't added."

There is no table support: no table node, no toolbar control, no keyboard.

## Problem

A user cannot put a table in a note. Tabular content — comparisons, small
data grids, structured lists — has no representation in the editor.

## Goals

1. A user can insert a table into a note and edit its cells.
2. A user can add and delete rows and columns, toggle a header row, and delete
   the table.
3. OneNote-style keyboard: `Tab` navigates cells and grows the table; `Shift`
   + `↑`/`↓` reorders rows.
4. Tables persist (via the CRDT) and survive collaboration like any other
   content; copying a note to Markdown produces a GitHub-flavoured table.

## Decisions (resolved during brainstorming)

- **Official Tiptap table extension** (backed by `prosemirror-tables`) for the
  table node and the standard operations — not a hand-rolled node and not a
  third-party "rich table" extension.
- **A `TableExtension.ts`** module adds one small custom `Extension` —
  `TableKeymap` — for the OneNote behaviour, plus a custom `moveRow` command.
- **The Table control is a single toolbar dropdown** (`TableMenu`), modelled on
  the existing `CalloutMenu`. Outside a table the button inserts one; inside a
  table it opens an operations menu.
- **Insert produces a fixed default** — a 3-column × 3-row table with a header
  row. No size picker.
- **Tab** = next cell; in the table's last cell it appends a row and moves
  into it. **Shift-Tab** = previous cell.
- **Shift-↑ / Shift-↓** move the current row up / down, clamped at the table's
  top and bottom edges.
- **Column resizing is off** (`resizable: false`) in v1.
- **No ADR** — this extends the already-chosen Tiptap editor with its own
  official extension; no new vendor or architectural decision.

## Non-goals

- Cell merging / splitting — GFM Markdown cannot represent merged cells, and it
  adds substantial complexity. Tables are simple grids.
- Moving *columns* (only rows reorder, per the request).
- Column resizing.
- A size-picker / dimension grid for insertion.
- Per-column or per-cell alignment controls (GFM supports column alignment but
  v1 ships no UI for it).
- Nested tables, or any guarantee about Markdown round-tripping of block-level
  cell content beyond what Turndown's GFM plugin already does.

## Design

### 1. Table extensions — `MarkdownExtensions.ts`

`apps/web/package.json` gains Tiptap's official table extension package(s),
pinned to **`3.23.4`** to match the installed `@tiptap/*`. The exact package
name and its exports (`Table`, `TableRow`, `TableHeader`, `TableCell`, and
whether v3 ships them as one package or several) are verified at
implementation time against `npm view`.

`buildExtensions` registers the table nodes alongside the existing extensions.
The `Table` node is configured `resizable: false`. The table nodes are
ordinary ProseMirror nodes, so:

- **Collaboration** — they sync through the existing `Collaboration` extension
  with no special handling; table edits land in `yjsState`.
- **Markdown export** — `htmlToMarkdown` needs no change. Turndown's GFM plugin
  converts the `<table>` Tiptap renders. A default table has a header row,
  which is exactly what a GFM table requires.

### 2. `TableExtension.ts` — the OneNote keymap and `moveRow`

A new file `apps/web/src/components/notes/Editor/TableExtension.ts` exports:

- **`moveRow(direction: -1 | 1)`** — a ProseMirror command that swaps the row
  containing the current selection with its neighbour. It locates the current
  row via the table's `TableMap`, builds a transaction that removes the row's
  `tableRow` node and re-inserts it at the neighbour's position (the moved row
  carries its cells, their content, and their header/body cell type), and maps
  the selection so the cursor stays in the moved row. It returns `false` —
  a no-op — when the move would cross the table's top or bottom edge, or when
  the selection is not in a table.

- **`TableKeymap`** — a small `Extension.create({ name: 'tableKeymap', … })`
  with `addKeyboardShortcuts`:
  - `Tab` — if the selection is in a table: run `goToNextCell(1)`; if that
    fails (the selection is in the table's last cell), run `addRowAfter` then
    `goToNextCell(1)`. If not in a table, return `false` so other `Tab`
    bindings (task-list indent, etc.) still work.
  - `Shift-Tab` — in a table: `goToNextCell(-1)`. Else `false`.
  - `Shift-ArrowUp` — in a table: `moveRow(-1)`. Else `false` (so the default
    vertical selection-extension is preserved outside tables).
  - `Shift-ArrowDown` — in a table: `moveRow(1)`. Else `false`.

  `TableKeymap` is registered in `buildExtensions` after the table nodes.

`TableExtension.ts` also exports the configured list of table extensions so
`buildExtensions` imports a single module for everything table-related.

### 3. `TableMenu.tsx` — the toolbar control

A new `apps/web/src/components/notes/Editor/TableMenu.tsx`, a `'use client'`
component modelled on `CalloutMenu.tsx`, rendered inside `EditorToolbar`. Prop:
`{ editor: Editor }`.

- **Outside a table** (`!editor.isActive('table')`) — the button is a plain
  toolbar button; clicking it runs
  `insertTable({ rows: 3, cols: 3, withHeaderRow: true })`.
- **Inside a table** — the button shows active and opens a dropdown menu of
  operations, grouped with subtle dividers:
  - *Rows:* insert row above (`addRowBefore`), insert row below
    (`addRowAfter`), delete row (`deleteRow`).
  - *Columns:* insert column left (`addColumnBefore`), insert column right
    (`addColumnAfter`), delete column (`deleteColumn`).
  - *Table:* toggle header row (`toggleHeaderRow`), delete table
    (`deleteTable`).
- Each menu item is **disabled when its command is not currently valid** —
  checked with `editor.can()` (e.g. "delete row" is disabled when the table
  has a single row). Each command is run focused, chained, like the rest of
  the toolbar.

`EditorToolbar.tsx` renders `<TableMenu editor={editor} />` in a sensible
group (next to the list / blockquote group) and drops the stale
"tables omitted in v1" comment.

### 4. Styling

Table CSS is added to the editor's `prose-paper` stylesheet (the same
stylesheet that styles the rest of the editor content). It covers: the
`prosemirror-tables` base rules the node needs to render (the `tableWrapper`,
fixed column layout), cell borders, header-cell emphasis (weight / subtle
background), and the `.selectedCell` highlight `prosemirror-tables` applies to
a cell selection. No column-resize handle styling — resizing is off.

### 5. i18n

A new `notes.editorTable` namespace in **both** `apps/web/messages/de.json`
and `apps/web/messages/en.json`, with identical keys: `insertTable` (the
button label / tooltip), `rowAbove`, `rowBelow`, `deleteRow`, `columnLeft`,
`columnRight`, `deleteColumn`, `toggleHeader`, `deleteTable`.

## Files

| File | Change |
|------|--------|
| `apps/web/package.json` | add the official Tiptap table extension package(s), pinned `3.23.4` |
| `apps/web/src/components/notes/Editor/TableExtension.ts` | **new** — configured table extensions, `TableKeymap`, `moveRow` |
| `apps/web/src/components/notes/Editor/TableExtension.test.ts` | **new** — keymap + `moveRow` tests |
| `apps/web/src/components/notes/Editor/MarkdownExtensions.ts` | register the table extensions + `TableKeymap` in `buildExtensions` |
| `apps/web/src/components/notes/Editor/TableMenu.tsx` | **new** — the Table toolbar dropdown |
| `apps/web/src/components/notes/Editor/TableMenu.test.tsx` | **new** — component tests |
| `apps/web/src/components/notes/Editor/EditorToolbar.tsx` | render `<TableMenu>`; drop the "tables omitted" comment |
| the editor stylesheet (`prose-paper`) | table CSS — base rules, borders, header, `.selectedCell` |
| `apps/web/src/lib/notes/markdown.test.ts` | regression test: a table → a GFM Markdown table |
| `apps/web/messages/{de,en}.json` | `notes.editorTable` keys |
| `vitest.config.ts` | coverage `include` for the new files if not glob-covered |

## Testing

- **`TableKeymap` / `moveRow`** — tests against a real Tiptap editor instance
  (jsdom): `Tab` in the table's last cell appends a row and moves into it;
  `Tab` in a mid-table cell only navigates; `Shift-↓` moves the current row
  down and `Shift-↑` moves it up; `Shift-↑` on the first row and `Shift-↓` on
  the last row are no-ops; a moved row keeps its cells' content; `Tab` outside
  a table does not trigger table behaviour.
- **`TableMenu`** — component tests: outside a table the button inserts a
  3×3 table; inside a table the button opens the menu; each item runs the
  matching command; an item is disabled when `editor.can()` reports its
  command invalid.
- **`markdown.ts`** — a regression test that the HTML Tiptap renders for a
  table converts to a GFM Markdown table (header row + body rows).
- The existing editor tests (`EditorToolbar`, `DocumentPanel`, etc.) stay
  green.

## Risks

- **`moveRow` correctness.** ProseMirror table transactions are intricate —
  the command must keep the `TableMap` consistent and the selection inside the
  moved row. Mitigated by the unit tests covering move up / down, edge
  clamping, and content preservation.
- **`Tab` keymap precedence.** `Tab` is also bound by task-list indentation
  and other extensions. `TableKeymap`'s handler returns `false` when the
  selection is not in a table, so non-table `Tab` bindings are unaffected;
  inside a table it handles `Tab` and stops propagation. Covered by a test.
- **Header-row Markdown export.** Export is clean for the default
  header-row table. A table whose header row was toggled off is a best-effort
  export — acceptable and documented as a non-goal boundary.
- **Concurrent structural edits.** Two users reordering rows in the same table
  at once is last-write-wins on the row structure; cell text still merges via
  the CRDT. Acceptable — consistent with every other structural edit in the
  collaborative editor.
