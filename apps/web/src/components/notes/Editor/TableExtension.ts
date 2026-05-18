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
          table.forEach((row) => {
            rows.push(row);
          });
          const reordered = rows.slice();
          const [moved] = reordered.splice(rowIndex, 1);
          // `rowIndex` is in-bounds (checked above) — this guard only narrows
          // the type for the splice below.
          if (moved === undefined) return false;
          reordered.splice(target, 0, moved);

          const tablePos = $from.before(tableDepth);
          tr.replaceWith(
            tablePos,
            tablePos + table.nodeSize,
            table.copy(Fragment.fromArray(reordered)),
          );

          // Keep the cursor inside the moved row (now at `target`) so the
          // shortcut can be pressed again to keep moving. Map `tablePos`
          // through the transaction so the position is resolved against the
          // post-replace document, not the original.
          let rowStart = tr.mapping.map(tablePos) + 1;
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
      // Inside a table these shortcuts always consume the event (return true),
      // so a press at an edge (first cell / first or last row) is a clean no-op
      // rather than falling through to default browser selection-extension.
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
