// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResizableImage } from './ResizableImage.tsx';

afterEach(cleanup);

const messages = { notes: { editorImage: { captionPlaceholder: 'Add a caption…' } } } as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

/** Minimal NodeViewProps stub — only the fields ResizableImage reads. */
const makeProps = (over: Partial<{ src: string; width: number | null; caption: string }> = {}) => {
  const updateAttributes = vi.fn();
  const attrs = {
    src: over.src ?? '/api/assets/a1',
    width: over.width ?? null,
    caption: over.caption ?? '',
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub for Tiptap NodeViewProps
  const props = { node: { attrs }, updateAttributes, selected: true } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub for Tiptap NodeViewProps
  return { props, updateAttributes };
};

describe('ResizableImage', () => {
  it('renders the image at its stored width', () => {
    const { props } = makeProps({ width: 200 });
    const { container } = render(wrap(<ResizableImage {...props} />));
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/assets/a1');
    expect(img?.style.width).toBe('200px');
  });

  it('shows the caption input with the placeholder', () => {
    const { props } = makeProps();
    const { container } = render(wrap(<ResizableImage {...props} />));
    expect(within(container).getByPlaceholderText('Add a caption…')).toBeTruthy();
  });

  it('editing the caption updates the node attribute', () => {
    const { props, updateAttributes } = makeProps();
    const { container } = render(wrap(<ResizableImage {...props} />));
    fireEvent.change(within(container).getByPlaceholderText('Add a caption…'), {
      target: { value: 'Sunset' },
    });
    expect(updateAttributes).toHaveBeenCalledWith({ caption: 'Sunset' });
  });

  it('renders a resize handle when the node is selected', () => {
    const { props } = makeProps();
    const { container } = render(wrap(<ResizableImage {...props} />));
    expect(container.querySelector('[data-testid="image-resize-handle"]')).not.toBeNull();
  });
});
