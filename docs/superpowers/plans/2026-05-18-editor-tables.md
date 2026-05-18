# Editor Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add table support to the Tiptap note editor — insert/edit tables via a toolbar dropdown, with OneNote-style keyboard (Tab grows the table, Shift+↑/↓ reorder rows).

**Architecture:** The official Tiptap table extension provides the table nodes and standard operations. A small custom `TableKeymap` extension adds the OneNote keyboard behaviour and a `moveRow` command. A `TableMenu` toolbar dropdown (modelled on the existing `CalloutMenu`) exposes insert + all operations. Tables persist through the existing Yjs CRDT and export to Markdown through the existing Turndown GFM path with no change.

**Tech Stack:** Next.js 16, React 19, TypeScript 6 strict, Tiptap v3 (`3.23.4`), `@tiptap/pm` (ProseMirror), Yjs, Vitest + jsdom + @testing-library/react, next-intl, TailwindCSS 4.

**Spec:** `docs/superpowers/specs/2026-05-18-editor-tables-design.md`

**Branch:** `feat/editor-tables` (you are in the worktree `.claude/worktrees/editor-tables`).

**Conventions:** TDD where a task specifies a test. TypeScript strict (no `any` without a `// reason:` comment). Conventional Commits. lefthook pre-commit MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root. Component/extension tests opt into jsdom with a `// @vitest-environment jsdom` pragma on line 1. Commit on the `feat/editor-tables` branch. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**Key facts established during research:**
- `@tiptap/extension-table@3.23.4` is a single self-contained package with **named exports** `Table`, `TableRow`, `TableHeader`, `TableCell` (and `TableKit`). The four nodes are imported explicitly.
- `@tiptap/pm@3.23.4` re-exports ProseMirror: `@tiptap/pm/model` (`Fragment`, `Node`), `@tiptap/pm/state` (`TextSelection`), `@tiptap/pm/tables` (`prosemirror-tables`). It is added as a direct dependency because `TableExtension.ts` imports from it.
- The repo's other Tiptap extensions use **default** imports (`import StarterKit from …`); the table package uses **named** imports — both are correct, per each package.
- Tiptap's table extension exposes the commands `insertTable`, `addRowBefore`, `addRowAfter`, `deleteRow`, `addColumnBefore`, `addColumnAfter`, `deleteColumn`, `toggleHeaderRow`, `deleteTable`, `goToNextCell`, `goToPreviousCell`.

---

## Task 1: Add the Tiptap table dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add the two dependencies**

In `apps/web/package.json`, add two entries to the `dependencies` object, in alphabetical order among the existing `@tiptap/*` entries, both pinned to the **exact** version `3.23.4` (no `^`/`~` — the repo pins exact versions):

```json
"@tiptap/extension-table": "3.23.4",
"@tiptap/pm": "3.23.4",
```

`@tiptap/extension-table` provides the table nodes; `@tiptap/pm` is the ProseMirror bundle (`TableExtension.ts` in Task 2 imports `@tiptap/pm/model` and `@tiptap/pm/state` — it must be a direct dependency, not a transitive one).

- [ ] **Step 2: Install**

Run from the repo root: `bun install`
Expected: completes; `bun.lock` updates.

- [ ] **Step 3: Verify the package exports**

Confirm the table package exports the four node extensions and the table commands. Run:

```bash
bun -e "import('@tiptap/extension-table').then(m => console.log(Object.keys(m).sort().join(', ')))"
```

Expected: the output includes `Table`, `TableCell`, `TableHeader`, `TableRow`. If any name differs, note it — Tasks 2's imports must match the actual exports.

- [ ] **Step 4: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: all 8 packages exit 0 (the new dependencies are unused so far).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json bun.lock
git commit -m "build(web): add @tiptap/extension-table and @tiptap/pm"
```

---

## Task 2: `TableExtension.ts` — table nodes, the OneNote keymap, `moveRow`

**Files:**
- Create: `apps/web/src/components/notes/Editor/TableExtension.ts`
- Create: `apps/web/src/components/notes/Editor/TableExtension.test.ts`
- Modify: `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/Editor/TableExtension.test.ts`:

```ts
// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { tableExtensions } from './TableExtension.ts';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** A 3-row table: a header row (H1/H2) and two body rows (A1/A2, B1/B2). */
const TABLE_HTML =
  '<table><tbody>' +
  '<tr><th>H1</th><th>H2</th></tr>' +
  '<tr><td>A1</td><td>A2</td></tr>' +
  '<tr><td>B1</td><td>B2</td></tr>' +
  '</tbody></table>';

const make = (content = TABLE_HTML): Editor => {
  editor = new Editor({ extensions: [StarterKit, ...tableExtensions], content });
  return editor;
};

/** Put the text cursor inside the first text node that contains `text`. */
const placeCursorIn = (e: Editor, text: string): void => {
  let pos = -1;
  e.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && (node.text ?? '').includes(text)) pos = p + 1;
  });
  if (pos === -1) throw new Error(`text not found: ${text}`);
  e.commands.setTextSelection(pos);
};

/** Dispatch a real keydown on the editor DOM so the ProseMirror keymap runs. */
const pressKey = (e: Editor, key: string, opts: { shift?: boolean } = {}): void => {
  e.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      shiftKey: opts.shift ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
};

const rowCount = (e: Editor): number => (e.getHTML().match(/<tr/g) ?? []).length;

describe('moveRow command', () => {
  it('moves the current row down, swapping it with the next', () => {
    const e = make();
    placeCursorIn(e, 'A1');
    expect(e.commands.moveRow(1)).toBe(true);
    const html = e.getHTML();
    // row A is now below row B
    expect(html.indexOf('B1')).toBeLessThan(html.indexOf('A1'));
  });

  it('moves the current row up, swapping it with the previous', () => {
    const e = make();
    placeCursorIn(e, 'B1');
    expect(e.commands.moveRow(-1)).toBe(true);
    const html = e.getHTML();
    expect(html.indexOf('B1')).toBeLessThan(html.indexOf('A1'));
  });

  it('is a no-op when moving the top row up', () => {
    const e = make();
    placeCursorIn(e, 'H1');
    expect(e.commands.moveRow(-1)).toBe(false);
  });

  it('is a no-op when moving the bottom row down', () => {
    const e = make();
    placeCursorIn(e, 'B1');
    expect(e.commands.moveRow(1)).toBe(false);
  });

  it('preserves the moved row’s cell content', () => {
    const e = make();
    placeCursorIn(e, 'A1');
    e.commands.moveRow(1);
    expect(e.getHTML()).toContain('A1');
    expect(e.getHTML()).toContain('A2');
  });

  it('is a no-op outside a table', () => {
    const e = make('<p>plain text</p>');
    placeCursorIn(e, 'plain');
    expect(e.commands.moveRow(1)).toBe(false);
  });
});

describe('Tab keymap', () => {
  it('appends a row when Tab is pressed in the table’s last cell', () => {
    const e = make();
    placeCursorIn(e, 'B2');
    const before = rowCount(e);
    pressKey(e, 'Tab');
    expect(rowCount(e)).toBe(before + 1);
  });

  it('does not append a row when Tab is pressed in a mid-table cell', () => {
    const e = make();
    placeCursorIn(e, 'A1');
    const before = rowCount(e);
    pressKey(e, 'Tab');
    expect(rowCount(e)).toBe(before);
  });
});

describe('Shift-Arrow keymap', () => {
  it('Shift-ArrowDown moves the current row down', () => {
    const e = make();
    placeCursorIn(e, 'A1');
    pressKey(e, 'ArrowDown', { shift: true });
    const html = e.getHTML();
    expect(html.indexOf('B1')).toBeLessThan(html.indexOf('A1'));
  });

  it('Shift-ArrowUp moves the current row up', () => {
    const e = make();
    placeCursorIn(e, 'B1');
    pressKey(e, 'ArrowUp', { shift: true });
    const html = e.getHTML();
    expect(html.indexOf('B1')).toBeLessThan(html.indexOf('A1'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Editor/TableExtension.test.ts`
Expected: FAIL — `./TableExtension.ts` does not exist.

- [ ] **Step 3: Implement `TableExtension.ts`**

Create `apps/web/src/components/notes/Editor/TableExtension.ts`:

```ts
import { Extension } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableKeymap: {
      /**
       * Move the table row containing the selection up (`-1`) or down (`1`),
       * swapping it with its neighbour. A no-op (returns `false`) when the
       * selection is not in a table or the move would leave the table.
       */
      moveRow: (direction: -1 | 1) => ReturnType;
    };
  }
}

/**
 * The OneNote-style table keyboard, plus the `moveRow` command the
 * Shift-Arrow shortcuts use. Kept in its own extension so the keymap and the
 * command are unit-testable in isolation. A high `priority` makes the `Tab`
 * binding win over task-list indentation when the selection is in a table.
 */
export const TableKeymap = Extension.create({
  name: 'tableKeymap',
  priority: 200,

  addCommands() {
    return {
      moveRow:
        (direction) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;

          // Find the depth of the enclosing `table` node.
          let tableDepth = -1;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'table') {
              tableDepth = d;
              break;
            }
          }
          if (tableDepth === -1) return false;

          const table = $from.node(tableDepth);
          const rowIndex = $from.index(tableDepth);
          const target = rowIndex + direction;
          if (target < 0 || target >= table.childCount) return false;
          if (!dispatch) return true;

          // Reorder the table's rows.
          const rows: PMNode[] = [];
          table.forEach((row) => rows.push(row));
          const reordered = rows.slice();
          const [moved] = reordered.splice(rowIndex, 1);
          if (moved === undefined) return false;
          reordered.splice(target, 0, moved);

          const tablePos = $from.before(tableDepth);
          const tableStart = $from.start(tableDepth);
          tr.replaceWith(
            tablePos,
            tablePos + table.nodeSize,
            table.copy(Fragment.fromArray(reordered)),
          );

          // Keep the cursor inside the moved row (now at `target`) so the
          // shortcut can be pressed again to keep moving.
          let rowStart = tableStart;
          for (let i = 0; i < target; i++) rowStart += reordered[i]?.nodeSize ?? 0;
          tr.setSelection(TextSelection.near(tr.doc.resolve(rowStart + 2)));

          dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this;
        if (!editor.isActive('table')) return false;
        // Move to the next cell; if there is none (last cell), grow the table.
        if (editor.commands.goToNextCell()) return true;
        editor.chain().addRowAfter().goToNextCell().run();
        return true;
      },
      'Shift-Tab': () => {
        const { editor } = this;
        if (!editor.isActive('table')) return false;
        editor.commands.goToPreviousCell();
        return true;
      },
      'Shift-ArrowUp': () => {
        const { editor } = this;
        if (!editor.isActive('table')) return false;
        editor.commands.moveRow(-1);
        return true;
      },
      'Shift-ArrowDown': () => {
        const { editor } = this;
        if (!editor.isActive('table')) return false;
        editor.commands.moveRow(1);
        return true;
      },
    };
  },
});

/**
 * Table extensions for the note editor: the four official Tiptap table nodes
 * (column resizing disabled) plus the OneNote keymap. `buildExtensions`
 * spreads this array into the editor's extension list.
 */
export const tableExtensions = [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TableKeymap,
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Editor/TableExtension.test.ts`
Expected: PASS (all 10 tests).

If the `Tab` / `Shift-Arrow` keymap tests fail because the synthetic `KeyboardEvent` does not reach the ProseMirror keymap in jsdom, do NOT weaken them — report it; the dispatch target may need to be `editor.view.dom` exactly (it is) or the event may need `view` set. The `moveRow` command tests must pass regardless.

- [ ] **Step 5: Register the table extensions in `MarkdownExtensions.ts`**

In `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`:

Add an import alongside the other local extension imports (`./CalloutExtension.ts` etc.):

```ts
import { tableExtensions } from './TableExtension.ts';
```

In the array `buildExtensions` returns, add `...tableExtensions` immediately after `PdfChipNode,` and before `FileHandler.configure(`:

```ts
    Callout,
    NoteImage,
    PdfChipNode,
    ...tableExtensions,
    FileHandler.configure({
```

- [ ] **Step 6: Verify typecheck and the editor test suite**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.
Run: `bun run vitest run apps/web/src/components/notes/Editor`
Expected: PASS — the new tests plus all existing editor tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/notes/Editor/TableExtension.ts \
        apps/web/src/components/notes/Editor/TableExtension.test.ts \
        apps/web/src/components/notes/Editor/MarkdownExtensions.ts
git commit -m "feat(notes): table nodes + OneNote table keymap in the editor"
```

---

## Task 3: `TableMenu.tsx` — the toolbar dropdown + i18n

**Files:**
- Create: `apps/web/src/components/notes/Editor/TableMenu.tsx`
- Create: `apps/web/src/components/notes/Editor/TableMenu.test.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

- [ ] **Step 1: Add the i18n keys**

In `apps/web/messages/en.json`, inside the `notes` object, add a `editorTable` key immediately **after** the `editorToolbar` object (mind the JSON commas):

```json
    "editorTable": {
      "insertTable": "Insert table",
      "rowAbove": "Insert row above",
      "rowBelow": "Insert row below",
      "deleteRow": "Delete row",
      "columnLeft": "Insert column left",
      "columnRight": "Insert column right",
      "deleteColumn": "Delete column",
      "toggleHeader": "Toggle header row",
      "deleteTable": "Delete table"
    },
```

In `apps/web/messages/de.json`, add the same key in the same place with German values:

```json
    "editorTable": {
      "insertTable": "Tabelle einfügen",
      "rowAbove": "Zeile oberhalb einfügen",
      "rowBelow": "Zeile unterhalb einfügen",
      "deleteRow": "Zeile löschen",
      "columnLeft": "Spalte links einfügen",
      "columnRight": "Spalte rechts einfügen",
      "deleteColumn": "Spalte löschen",
      "toggleHeader": "Kopfzeile umschalten",
      "deleteTable": "Tabelle löschen"
    },
```

Both files must keep an identical key tree.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/notes/Editor/TableMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { TableMenu } from './TableMenu.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    editorTable: {
      insertTable: 'Insert table',
      rowAbove: 'Insert row above',
      rowBelow: 'Insert row below',
      deleteRow: 'Delete row',
      columnLeft: 'Insert column left',
      columnRight: 'Insert column right',
      deleteColumn: 'Delete column',
      toggleHeader: 'Toggle header row',
      deleteTable: 'Delete table',
    },
  },
} as const;

/**
 * Editor stub: `chain()` records terminal commands; `isActive('table')`
 * reflects `inTable`; `can()` returns a proxy where every command is `true`
 * unless overridden in `can`.
 */
const makeEditor = (opts: { inTable?: boolean; can?: Record<string, boolean> } = {}) => {
  const commands: string[] = [];
  const chain: Record<string, unknown> = {};
  const proxy = new Proxy(chain, {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        if (prop !== 'focus' && prop !== 'run') {
          commands.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(',')})`);
        }
        return proxy;
      };
    },
  });
  const can = new Proxy(
    {},
    { get: (_t, prop: string) => () => opts.can?.[prop] ?? true },
  );
  const editor = {
    isActive: (name: string) => name === 'table' && Boolean(opts.inTable),
    chain: () => proxy,
    can: () => can,
  } as unknown as Editor;
  return { editor, commands };
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('TableMenu', () => {
  it('renders a toolbar button and no menu initially', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<TableMenu editor={editor} />));
    expect(within(container).getByLabelText('Insert table')).toBeTruthy();
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('outside a table, clicking the button inserts a 3x3 table with a header row', () => {
    const { editor, commands } = makeEditor({ inTable: false });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    expect(commands.join('')).toContain('insertTable(');
    expect(commands.join('')).toContain('"rows":3');
    expect(commands.join('')).toContain('"cols":3');
    expect(commands.join('')).toContain('"withHeaderRow":true');
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('inside a table, clicking the button opens the operations menu', () => {
    const { editor } = makeEditor({ inTable: true });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    const menu = within(container).getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(8);
  });

  it('inside a table, a menu item runs its command and closes the menu', () => {
    const { editor, commands } = makeEditor({ inTable: true });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    fireEvent.click(within(container).getByRole('menuitem', { name: 'Insert row below' }));
    expect(commands).toContain('addRowAfter()');
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('runs the matching command for every operation', () => {
    const cases: Array<[label: string, command: string]> = [
      ['Insert row above', 'addRowBefore()'],
      ['Insert row below', 'addRowAfter()'],
      ['Delete row', 'deleteRow()'],
      ['Insert column left', 'addColumnBefore()'],
      ['Insert column right', 'addColumnAfter()'],
      ['Delete column', 'deleteColumn()'],
      ['Toggle header row', 'toggleHeaderRow()'],
      ['Delete table', 'deleteTable()'],
    ];
    for (const [label, command] of cases) {
      const { editor, commands } = makeEditor({ inTable: true });
      const { container, unmount } = render(wrap(<TableMenu editor={editor} />));
      fireEvent.click(within(container).getByLabelText('Insert table'));
      fireEvent.click(within(container).getByRole('menuitem', { name: label }));
      expect(commands).toContain(command);
      unmount();
    }
  });

  it('disables a menu item whose command is not currently valid', () => {
    const { editor } = makeEditor({ inTable: true, can: { deleteRow: false } });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    const item = within(container).getByRole('menuitem', { name: 'Delete row' });
    expect(item.hasAttribute('disabled')).toBe(true);
  });

  it('Escape closes the menu', () => {
    const { editor } = makeEditor({ inTable: true });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('a click outside closes the menu', () => {
    const { editor } = makeEditor({ inTable: true });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(within(container).queryByRole('menu')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Editor/TableMenu.test.tsx`
Expected: FAIL — `./TableMenu.tsx` does not exist.

- [ ] **Step 4: Implement `TableMenu.tsx`**

Create `apps/web/src/components/notes/Editor/TableMenu.tsx`:

```tsx
'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Props = {
  editor: Editor;
};

/** One menu operation: an i18n key, the command to run, the can-run check. */
type TableOp = { key: string; run: () => void; can: () => boolean };

/**
 * Toolbar control for tables. Outside a table the button inserts a 3x3 table
 * with a header row. Inside a table it opens a dropdown of operations,
 * grouped (rows / columns / table); each item is disabled when its command is
 * not currently valid. Modelled on `CalloutMenu` — owns only its open state,
 * closes on Escape and outside-click.
 */
export function TableMenu({ editor }: Props) {
  const t = useTranslations('notes.editorTable');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inTable = editor.isActive('table');

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Leaving a table closes a stale-open menu.
  useEffect(() => {
    if (!inTable) setOpen(false);
  }, [inTable]);

  const onButtonClick = () => {
    if (inTable) {
      setOpen((v) => !v);
    } else {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }
  };

  const groups: TableOp[][] = [
    [
      {
        key: 'rowAbove',
        run: () => editor.chain().focus().addRowBefore().run(),
        can: () => editor.can().addRowBefore(),
      },
      {
        key: 'rowBelow',
        run: () => editor.chain().focus().addRowAfter().run(),
        can: () => editor.can().addRowAfter(),
      },
      {
        key: 'deleteRow',
        run: () => editor.chain().focus().deleteRow().run(),
        can: () => editor.can().deleteRow(),
      },
    ],
    [
      {
        key: 'columnLeft',
        run: () => editor.chain().focus().addColumnBefore().run(),
        can: () => editor.can().addColumnBefore(),
      },
      {
        key: 'columnRight',
        run: () => editor.chain().focus().addColumnAfter().run(),
        can: () => editor.can().addColumnAfter(),
      },
      {
        key: 'deleteColumn',
        run: () => editor.chain().focus().deleteColumn().run(),
        can: () => editor.can().deleteColumn(),
      },
    ],
    [
      {
        key: 'toggleHeader',
        run: () => editor.chain().focus().toggleHeaderRow().run(),
        can: () => editor.can().toggleHeaderRow(),
      },
      {
        key: 'deleteTable',
        run: () => editor.chain().focus().deleteTable().run(),
        can: () => editor.can().deleteTable(),
      },
    ],
  ];

  const pick = (op: TableOp) => {
    op.run();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('insertTable')}
        title={t('insertTable')}
        aria-haspopup={inTable ? 'menu' : undefined}
        aria-expanded={inTable ? open : undefined}
        aria-pressed={inTable}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onButtonClick}
        className={`hover:bg-muted inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm transition-colors ${
          inTable ? 'bg-accent text-white' : 'text-foreground'
        }`}
      >
        <span aria-hidden="true">▦</span>
      </button>
      {inTable && open ? (
        <div
          role="menu"
          aria-label={t('insertTable')}
          className="border-paper-line bg-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border p-1 shadow-lg"
        >
          {groups.map((group, groupIndex) => (
            <div
              key={group[0]?.key ?? groupIndex}
              className={groupIndex > 0 ? 'border-paper-line/60 mt-1 border-t pt-1' : ''}
            >
              {group.map((op) => (
                <button
                  key={op.key}
                  type="button"
                  role="menuitem"
                  disabled={!op.can()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(op)}
                  className="hover:bg-muted flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t(op.key)}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Editor/TableMenu.test.tsx`
Expected: PASS (8 tests).

Also run `bun run typecheck` — expect all 8 packages exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Editor/TableMenu.tsx \
        apps/web/src/components/notes/Editor/TableMenu.test.tsx \
        apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(notes): TableMenu toolbar dropdown + editorTable i18n"
```

---

## Task 4: Render `TableMenu` in the editor toolbar

**Files:**
- Modify: `apps/web/src/components/notes/Editor/EditorToolbar.tsx`
- Modify: `apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`

- [ ] **Step 1: Add a failing test**

In `apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`:

First, the toolbar now renders `TableMenu`, which calls `useTranslations('notes.editorTable')` — so the test `messages` object MUST gain that namespace or every toolbar test throws. In the `messages` constant, add an `editorTable` block inside `notes` (alongside `callouts` and `editorToolbar`):

```ts
    editorTable: {
      insertTable: 'Insert table',
      rowAbove: 'Insert row above',
      rowBelow: 'Insert row below',
      deleteRow: 'Delete row',
      columnLeft: 'Insert column left',
      columnRight: 'Insert column right',
      deleteColumn: 'Delete column',
      toggleHeader: 'Toggle header row',
      deleteTable: 'Delete table',
    },
```

Then add a test at the end of the `describe('EditorToolbar', …)` block:

```ts
  it('renders the table menu button', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    expect(within(container).getByLabelText('Insert table')).toBeTruthy();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`
Expected: FAIL — there is no element labelled "Insert table" yet.

- [ ] **Step 3: Render `TableMenu` in the toolbar**

In `apps/web/src/components/notes/Editor/EditorToolbar.tsx`:

Add the import next to the `CalloutMenu` import:

```ts
import { CalloutMenu } from './CalloutMenu.tsx';
import { TableMenu } from './TableMenu.tsx';
```

In the file's top doc-comment, delete the two lines that say tables are omitted — the lines reading `*   - tables ship as a separate Tiptap extension we haven't added` and adjust the surrounding sentence so it no longer claims tables are omitted (keep the comment accurate: image / colour-picker may still be omitted; tables are not).

In the final `<Group>` that currently contains `<CalloutMenu editor={editor} />`, add `<TableMenu>` after it:

```tsx
        <Group>
          <CalloutMenu editor={editor} />
          <TableMenu editor={editor} />
        </Group>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`
Expected: PASS — the new test plus all existing toolbar tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Editor/EditorToolbar.tsx \
        apps/web/src/components/notes/Editor/EditorToolbar.test.tsx
git commit -m "feat(notes): render the TableMenu in the editor toolbar"
```

---

## Task 5: Table styling

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add the table CSS**

In `apps/web/src/app/globals.css`, find the `.prose-paper` editor-surface rules (the block that includes `.prose-paper :where(a) { … }`). Immediately after the `.prose-paper :where(a)` rule, add the table rules:

```css
/* Tables. `prosemirror-tables` needs fixed layout + a wrapper for horizontal
 * overflow; it also tags a cell selection with `.selectedCell`. Column
 * resizing is disabled, so no resize-handle styling. */
.prose-paper .tableWrapper {
  overflow-x: auto;
}
.prose-paper :where(table) {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}
.prose-paper :where(th, td) {
  border: 1px solid var(--color-paper-line);
  padding: 0.4em 0.6em;
  vertical-align: top;
  text-align: left;
  min-width: 3em;
}
.prose-paper :where(th) {
  background: var(--color-muted);
  font-weight: 600;
}
.prose-paper .selectedCell {
  background: var(--color-accent-soft);
}
.prose-paper :where(th, td) > :where(p):last-child {
  margin-bottom: 0;
}
```

(`--color-paper-line`, `--color-muted`, `--color-accent-soft` are existing CSS custom properties used elsewhere in this file.)

- [ ] **Step 2: Verify the build compiles the CSS**

Run: `bun --filter @app/web build`
Expected: exit 0 (this confirms the CSS is syntactically valid and Tailwind/PostCSS accepts it).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(notes): table styling for the editor surface"
```

---

## Task 6: Markdown export regression test

**Files:**
- Modify: `apps/web/src/lib/notes/markdown.test.ts`

- [ ] **Step 1: Add the test**

In `apps/web/src/lib/notes/markdown.test.ts`, inside the `describe('htmlToMarkdown', …)` block, add:

```ts
  it('converts a table to a GFM Markdown table', () => {
    const html =
      '<table><tbody>' +
      '<tr><th>Name</th><th>Role</th></tr>' +
      '<tr><td>Ada</td><td>Lead</td></tr>' +
      '</tbody></table>';
    const md = htmlToMarkdown(html);
    expect(md).toMatch(/\|\s*Name\s*\|\s*Role\s*\|/);
    expect(md).toMatch(/\|\s*-+\s*\|\s*-+\s*\|/);
    expect(md).toMatch(/\|\s*Ada\s*\|\s*Lead\s*\|/);
  });
```

This is a regression guard — `htmlToMarkdown` already converts tables via Turndown's GFM plugin. The test should PASS as soon as it is written. The regexes tolerate whitespace differences; if the GFM plugin's exact output still differs, adjust the regexes to match the actual output (the test captures existing behaviour — do not change `markdown.ts`).

- [ ] **Step 2: Run the test**

Run: `bun run vitest run apps/web/src/lib/notes/markdown.test.ts`
Expected: PASS (the new test plus all existing markdown tests).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/notes/markdown.test.ts
git commit -m "test(notes): regression test for table Markdown export"
```

---

## Task 7: Coverage wiring + full verification

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the new files to the coverage include list**

In `vitest.config.ts`, the `coverage.include` array lists Editor components by explicit path (e.g. `'apps/web/src/components/notes/Editor/CalloutExtension.ts'`, `'…/CalloutMenu.tsx'`). Add two entries alongside them:

```ts
    'apps/web/src/components/notes/Editor/TableExtension.ts',
    'apps/web/src/components/notes/Editor/TableMenu.tsx',
```

(`markdown.ts` is already covered by the `apps/web/src/lib/notes/**/*.ts` glob; `EditorToolbar.tsx` is already listed.)

- [ ] **Step 2: Full test suite**

Run: `bun run vitest run`
Expected: every test file passes.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 4: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. Catches Turbopack-only compile errors that `vitest`/`tsc` miss.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for the table editor files"
```

---

## Self-Review

**Spec coverage:**
- Insert a table + edit cells → Task 2 (table nodes registered) + Task 3 (`TableMenu` insert) + Task 5 (styling).
- Add/delete rows & columns, toggle header, delete table → Task 3 (`TableMenu` operations).
- OneNote keyboard — Tab navigates / grows, Shift+↑/↓ reorder rows → Task 2 (`TableKeymap`, `moveRow`).
- Persist via the CRDT, survive collaboration → automatic (table nodes are ordinary ProseMirror content synced by the existing `Collaboration` extension); no task needed, noted in the spec.
- Copy to Markdown produces a GFM table → Task 6 (regression test; `markdown.ts` needs no change — Turndown's GFM plugin already converts tables).
- The Table control is a single context-aware toolbar dropdown → Task 3 + Task 4.
- Insert default = 3×3 with a header row → Task 3 (`insertTable({ rows: 3, cols: 3, withHeaderRow: true })`).
- `resizable: false` → Task 2 (`Table.configure({ resizable: false })`).
- i18n `notes.editorTable` in both locales → Task 3.
- Turbopack build verification → Task 7.

**Placeholder scan:** No "TBD"/"implement later". Every task ships complete code. The one verification-deferred item — Task 1 Step 3 confirms the table package's export names — is a concrete `bun -e` check, not a placeholder. Task 6 notes the regex may need tuning to the GFM plugin's exact output; the test code is fully written, the note only covers a whitespace nuance in a regression guard.

**Type consistency:** `tableExtensions` is defined in `TableExtension.ts` (Task 2) and imported by `MarkdownExtensions.ts` (Task 2 Step 5) and `TableExtension.test.ts` (Task 2 Step 1) under that exact name. `moveRow` is declared in the `@tiptap/core` `Commands` augmentation in Task 2 and called as `editor.commands.moveRow(±1)` in the same file's keymap and in the test. `TableMenu` is exported from `TableMenu.tsx` (Task 3) and imported by `EditorToolbar.tsx` (Task 4) and `TableMenu.test.tsx` (Task 3) under that name. The `notes.editorTable` keys (`insertTable`, `rowAbove`, `rowBelow`, `deleteRow`, `columnLeft`, `columnRight`, `deleteColumn`, `toggleHeader`, `deleteTable`) are identical across `en.json`, `de.json` (Task 3), the `TableMenu.test.tsx` messages (Task 3), and the `EditorToolbar.test.tsx` messages (Task 4). The Tiptap table command names (`insertTable`, `addRowBefore`/`addRowAfter`/`deleteRow`, `addColumnBefore`/`addColumnAfter`/`deleteColumn`, `toggleHeaderRow`, `deleteTable`, `goToNextCell`/`goToPreviousCell`) are used consistently in `TableExtension.ts` and `TableMenu.tsx`.
