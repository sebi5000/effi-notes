// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
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

  it("preserves the moved row's cell content", () => {
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

  it('moves the row down when a CellSelection is active', () => {
    const e = make();
    // Find the text position of "A1", then walk up to the enclosing cell node
    // to get the position just before it (the anchor for CellSelection.create).
    let textPos = -1;
    e.state.doc.descendants((node, pos) => {
      if (textPos === -1 && node.isText && (node.text ?? '').includes('A1')) {
        textPos = pos + 1;
      }
    });
    if (textPos === -1) throw new Error('A1 not found');
    // Resolve the text position and go up two levels (text → paragraph → cell).
    const $textPos = e.state.doc.resolve(textPos);
    const cellPos = $textPos.before($textPos.depth - 1);
    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, cellPos)));
    expect(e.commands.moveRow(1)).toBe(true);
    const html = e.getHTML();
    expect(html.indexOf('B1')).toBeLessThan(html.indexOf('A1'));
  });
});

describe('Tab keymap', () => {
  it("appends a row when Tab is pressed in the table's last cell", () => {
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
