// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { CalloutMenu } from './CalloutMenu.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    callouts: {
      label: 'Insert callout',
      note: 'Note',
      tip: 'Tip',
      important: 'Important',
      warning: 'Warning',
      caution: 'Caution',
    },
  },
} as const;

/** Editor stub — records the commands `chain().focus().setCallout(t).run()`. */
const makeEditor = () => {
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
  const editor = { chain: () => proxy } as unknown as Editor;
  return { editor, commands };
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('CalloutMenu', () => {
  it('renders a toolbar button and no menu initially', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    expect(within(container).getByLabelText('Insert callout')).toBeTruthy();
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('opens a menu with the five callout types when clicked', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    const menu = within(container).getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(5);
    expect(menu.textContent).toContain('Note');
    expect(menu.textContent).toContain('Caution');
  });

  it('clicking a type runs setCallout with that type and closes the menu', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    fireEvent.click(within(container).getByRole('menuitem', { name: 'Warning' }));
    expect(commands).toContain('setCallout("warning")');
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('Escape closes the menu', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('a click outside closes the menu', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('the toggle button prevents the mousedown default (keeps editor focus)', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    const button = within(container).getByLabelText('Insert callout');
    expect(fireEvent.mouseDown(button)).toBe(false);
  });

  it('a menu item prevents the mousedown default (keeps editor focus)', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    const item = within(container).getByRole('menuitem', { name: 'Tip' });
    expect(fireEvent.mouseDown(item)).toBe(false);
  });
});
