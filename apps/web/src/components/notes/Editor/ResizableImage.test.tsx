// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/notes/api-client.ts';
import { ResizableImage } from './ResizableImage.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it('dragging the resize handle updates the width on pointer up', () => {
    const { props, updateAttributes } = makeProps({ width: 200 });
    const { container } = render(wrap(<ResizableImage {...props} />));
    const img = container.querySelector('img') as HTMLImageElement;
    const frame = img.parentElement as HTMLElement;
    Object.defineProperty(img, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(frame, 'clientWidth', { value: 600, configurable: true });
    const handle = container.querySelector('[data-testid="image-resize-handle"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 60 });
    fireEvent.pointerUp(window, { clientX: 60 });
    expect(updateAttributes).toHaveBeenCalledWith({ width: 260 });
  });

  it('debounce-syncs the caption to the asset after editing', () => {
    vi.useFakeTimers();
    try {
      const patchSpy = vi
        .spyOn(assetsApi, 'patchCaption')
        .mockResolvedValue({ id: 'a1', caption: '' });
      const { props } = makeProps({ src: '/api/assets/a1' });
      const { container } = render(wrap(<ResizableImage {...props} />));
      fireEvent.change(within(container).getByPlaceholderText('Add a caption…'), {
        target: { value: 'Mountains' },
      });
      vi.advanceTimersByTime(700);
      expect(patchSpy).toHaveBeenCalledWith('a1', 'Mountains');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not render a resize handle and renders no width when deselected', () => {
    const { props } = makeProps();
    props.selected = false;
    const { container } = render(wrap(<ResizableImage {...props} />));
    expect(container.querySelector('[data-testid="image-resize-handle"]')).toBeNull();
    expect(container.querySelector('img')?.style.width).toBe('');
  });

  it('skips the asset sync when the src has no extractable id', () => {
    vi.useFakeTimers();
    try {
      const patchSpy = vi
        .spyOn(assetsApi, 'patchCaption')
        .mockResolvedValue({ id: '', caption: '' });
      const { props, updateAttributes } = makeProps({ src: '' });
      const { container } = render(wrap(<ResizableImage {...props} />));
      fireEvent.change(within(container).getByPlaceholderText('Add a caption…'), {
        target: { value: 'Orphan' },
      });
      vi.advanceTimersByTime(700);
      expect(updateAttributes).toHaveBeenCalledWith({ caption: 'Orphan' });
      expect(patchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops mouse and key events on the caption input from bubbling', () => {
    const { props } = makeProps();
    const { container } = render(wrap(<ResizableImage {...props} />));
    const input = within(container).getByPlaceholderText('Add a caption…');
    const mouseDown = fireEvent.mouseDown(input);
    const keyDown = fireEvent.keyDown(input, { key: 'a' });
    expect(mouseDown).toBe(true);
    expect(keyDown).toBe(true);
  });
});
