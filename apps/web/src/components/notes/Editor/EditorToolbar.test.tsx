// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from './EditorToolbar.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    editorToolbar: {
      label: 'Formatting',
      h1: 'Heading 1',
      h2: 'Heading 2',
      h3: 'Heading 3',
      bold: 'Bold',
      italic: 'Italic',
      strike: 'Strikethrough',
      code: 'Inline code',
      bulletList: 'Bullet list',
      orderedList: 'Numbered list',
      taskList: 'Task list',
      blockquote: 'Quote',
      link: 'Link',
      linkPrompt: 'Link URL',
    },
  },
} as const;

/**
 * Minimal Tiptap Editor stub. `chain()` returns a self-referential proxy so
 * `editor.chain().focus().toggleBold().run()` resolves; each terminal command
 * is recorded so the test can assert which command fired.
 */
const makeEditor = (active: Record<string, boolean> = {}) => {
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
    isActive: (name: string, attrs?: Record<string, unknown>) =>
      attrs ? Boolean(active[`${name}:${JSON.stringify(attrs)}`]) : Boolean(active[name]),
    chain: () => proxy,
    getAttributes: () => ({ href: '' }),
  } as unknown as Editor;
  return { editor, commands };
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('EditorToolbar', () => {
  it('renders nothing when there is no editor', () => {
    const { container } = render(wrap(<EditorToolbar editor={null} />));
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('renders the formatting toolbar when an editor is present', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(within(container).getByLabelText('Bold')).toBeTruthy();
    expect(within(container).getByLabelText('Italic')).toBeTruthy();
  });

  it('clicking Bold runs toggleBold', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Bold'));
    expect(commands).toContain('toggleBold()');
  });

  it('clicking Italic runs toggleItalic', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Italic'));
    expect(commands).toContain('toggleItalic()');
  });

  it('clicking Heading 2 runs toggleHeading with level 2', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Heading 2'));
    expect(commands.some((c) => c.startsWith('toggleHeading('))).toBe(true);
    expect(commands.join('')).toContain('"level":2');
  });

  it('clicking the bullet list runs toggleBulletList', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Bullet list'));
    expect(commands).toContain('toggleBulletList()');
  });

  it('clicking the task list runs toggleTaskList', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Task list'));
    expect(commands).toContain('toggleTaskList()');
  });

  it('marks the Bold button as pressed when the mark is active', () => {
    const { editor } = makeEditor({ bold: true });
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    expect(within(container).getByLabelText('Bold').getAttribute('aria-pressed')).toBe('true');
  });

  it('the link button prompts and applies setLink with the entered URL', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('https://effi.notes');
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Link'));
    expect(commands.join('')).toContain('setLink');
    expect(commands.join('')).toContain('https://effi.notes');
    promptSpy.mockRestore();
  });

  it('the link button removes the link when the prompt is cleared', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('');
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Link'));
    expect(commands).toContain('unsetLink()');
    promptSpy.mockRestore();
  });

  it('cancelling the link prompt makes no change', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Link'));
    expect(commands.join('')).not.toContain('setLink');
    expect(commands).not.toContain('unsetLink()');
    promptSpy.mockRestore();
  });
});
