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
  const can = new Proxy({}, { get: (_t, prop: string) => () => opts.can?.[prop] ?? true });
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

  it('the toggle button prevents the mousedown default (keeps editor focus)', () => {
    const { editor } = makeEditor({ inTable: true });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    const button = within(container).getByLabelText('Insert table');
    expect(fireEvent.mouseDown(button)).toBe(false);
  });

  it('a menu item prevents the mousedown default (keeps editor focus)', () => {
    const { editor } = makeEditor({ inTable: true });
    const { container } = render(wrap(<TableMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    const item = within(container).getByRole('menuitem', { name: 'Insert row above' });
    expect(fireEvent.mouseDown(item)).toBe(false);
  });

  it('menu does not re-appear when cursor re-enters a table without an outside-click', () => {
    // Open the menu while inside a table, then re-render with a different
    // editor where inTable is false (simulating cursor leaving the table).
    // The render-phase pattern should reset open to false so that when the
    // cursor enters a new table the menu does not re-appear unbidden.
    const { editor: editorIn } = makeEditor({ inTable: true });
    const { container, rerender } = render(wrap(<TableMenu editor={editorIn} />));
    fireEvent.click(within(container).getByLabelText('Insert table'));
    expect(within(container).queryByRole('menu')).not.toBeNull();

    // Simulate cursor leaving the table — re-render with inTable: false
    const { editor: editorOut } = makeEditor({ inTable: false });
    rerender(wrap(<TableMenu editor={editorOut} />));
    expect(within(container).queryByRole('menu')).toBeNull();

    // Simulate cursor re-entering a table — re-render with inTable: true
    // Without the fix, open would still be true and the menu would reappear.
    const { editor: editorIn2 } = makeEditor({ inTable: true });
    rerender(wrap(<TableMenu editor={editorIn2} />));
    expect(within(container).queryByRole('menu')).toBeNull();
  });
});
