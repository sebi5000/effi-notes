// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { HIGHLIGHT_COLORS, HighlightMenu } from './HighlightMenu.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    highlight: {
      label: 'Highlight',
      yellow: 'Yellow',
      green: 'Green',
      blue: 'Blue',
      red: 'Red',
      clear: 'Remove highlight',
    },
  },
} as const;

/**
 * Editor stub — records the commands the menu pipes through
 * `chain().focus()…run()` and lets the test stage `isActive('highlight')`
 * for the "clear" affordance branch.
 */
const makeEditor = (opts: { highlightActive?: boolean } = {}) => {
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
  const editor = {
    chain: () => proxy,
    isActive: (name: string) => name === 'highlight' && opts.highlightActive === true,
  } as unknown as Editor;
  return { editor, commands };
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('HighlightMenu', () => {
  it('renders a toolbar button and no menu initially', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<HighlightMenu editor={editor} />));
    expect(within(container).getByLabelText('Highlight')).toBeTruthy();
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('opens a menu with the four colour swatches when clicked', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<HighlightMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Highlight'));
    const menu = within(container).getByRole('menu');
    // Four swatches always render; the "Clear" item appears only when an
    // active highlight is present (covered in a separate test).
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(HIGHLIGHT_COLORS.length);
    for (const c of HIGHLIGHT_COLORS) {
      expect(within(menu).getByLabelText(c.id.replace(/^./, (s) => s.toUpperCase()))).toBeTruthy();
    }
  });

  it('clicking a swatch runs setHighlight with that colour and closes the menu', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<HighlightMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Highlight'));
    fireEvent.click(within(container).getByRole('menuitem', { name: 'Yellow' }));
    const yellow = HIGHLIGHT_COLORS.find((c) => c.id === 'yellow');
    expect(yellow).toBeDefined();
    if (yellow) {
      expect(commands).toContain(`setHighlight({"color":"${yellow.css}"})`);
    }
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('shows a Clear item only when a highlight is already active', () => {
    const { editor: idle } = makeEditor({ highlightActive: false });
    const idleR = render(wrap(<HighlightMenu editor={idle} />));
    fireEvent.click(within(idleR.container).getByLabelText('Highlight'));
    expect(
      within(idleR.container).queryByRole('menuitem', { name: 'Remove highlight' }),
    ).toBeNull();
    cleanup();

    const { editor: active, commands } = makeEditor({ highlightActive: true });
    const activeR = render(wrap(<HighlightMenu editor={active} />));
    fireEvent.click(within(activeR.container).getByLabelText('Highlight'));
    const clearItem = within(activeR.container).getByRole('menuitem', { name: 'Remove highlight' });
    expect(clearItem).toBeTruthy();
    fireEvent.click(clearItem);
    expect(commands).toContain('unsetHighlight()');
  });

  it('Escape closes the menu', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<HighlightMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Highlight'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('a click outside closes the menu', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<HighlightMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Highlight'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('the toggle button prevents the mousedown default (keeps editor focus)', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<HighlightMenu editor={editor} />));
    const button = within(container).getByLabelText('Highlight');
    expect(fireEvent.mouseDown(button)).toBe(false);
  });

  it('a swatch prevents the mousedown default (keeps editor focus)', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<HighlightMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Highlight'));
    const swatch = within(container).getByRole('menuitem', { name: 'Green' });
    expect(fireEvent.mouseDown(swatch)).toBe(false);
  });
});
