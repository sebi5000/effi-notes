// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyMarkdownButton } from './CopyMarkdownButton.tsx';

afterEach(cleanup);

const messages = {
  notes: { editorActions: { copyMarkdown: 'Copy as Markdown', copied: 'Copied' } },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

/** Minimal Editor stub — only `getHTML` is used by the button. */
const editorWith = (html: string): Editor => ({ getHTML: () => html }) as unknown as Editor;

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

describe('CopyMarkdownButton', () => {
  it('copies the editor content as Markdown', async () => {
    const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<h1>Hi</h1>')} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Hi'));
  });

  it('shows "Copied" feedback after a successful copy', async () => {
    const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<p>x</p>')} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    await waitFor(() => expect(within(container).queryByText('Copied')).not.toBeNull());
  });

  it('does nothing when there is no editor', () => {
    const { container } = render(wrap(<CopyMarkdownButton editor={null} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not crash when the clipboard write is rejected', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<p>x</p>')} />));
    fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(within(container).queryByText('Copied')).toBeNull();
  });

  it('reverts the feedback after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(wrap(<CopyMarkdownButton editor={editorWith('<p>x</p>')} />));
      fireEvent.click(within(container).getByLabelText('Copy as Markdown'));
      await vi.waitFor(() => expect(within(container).queryByText('Copied')).not.toBeNull());
      vi.advanceTimersByTime(2000);
      await vi.waitFor(() => expect(within(container).queryByText('Copied')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });
});
