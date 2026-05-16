// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor, isNodeSelection } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentPanel } from './DocumentPanel.tsx';
import { NoteImage } from './ImageExtension.ts';
import { PdfChipNode } from './PdfChipExtension.ts';

afterEach(cleanup);

// jsdom has no IntersectionObserver — stub it with one that captures its
// callback and the observed elements so tests can drive the scroll-spy.
type IoEntry = { target: Element; isIntersecting: boolean };
let ioCallback: ((entries: IoEntry[]) => void) | null = null;
let ioObserved: Element[] = [];

beforeEach(() => {
  ioCallback = null;
  ioObserved = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: IoEntry[]) => void) {
        ioCallback = cb;
      }
      observe(el: Element) {
        ioObserved.push(el);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom does not implement scrollIntoView — the jump chain calls it.
  Element.prototype.scrollIntoView = () => {};
});

const messages = {
  notes: {
    docPanel: {
      title: 'Document',
      outline: 'Outline',
      images: 'Images',
      pdfs: 'PDFs',
      links: 'Links',
      hide: 'Hide document panel',
      internal: 'Internal',
      external: 'External',
      empty: {
        outline: 'No headings yet',
        images: 'No images',
        pdfs: 'No PDFs',
        links: 'No links',
      },
    },
  },
};

const EXTENSIONS = [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode];

const makeEditor = () =>
  new Editor({
    extensions: EXTENSIONS,
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
      ],
    },
  });

/** An editor with two headings, for the scroll-spy `Math.min` / delete branches. */
const makeTwoHeadingEditor = () =>
  new Editor({
    extensions: EXTENSIONS,
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section B' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'more' }] },
      ],
    },
  });

/** An editor whose document contains a heading and an image asset. */
const makeImageEditor = () =>
  new Editor({
    extensions: EXTENSIONS,
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section A' }] },
        { type: 'image', attrs: { src: '/api/assets/img1', caption: 'A diagram' } },
      ],
    },
  });

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const renderPanel = (editor: Editor | null, onCollapse: () => void = () => {}) =>
  render(wrap(<DocumentPanel editor={editor} onCollapse={onCollapse} />));

describe('DocumentPanel', () => {
  it('renders all four section titles', () => {
    renderPanel(makeEditor());
    expect(screen.getByText('Outline')).toBeTruthy();
    expect(screen.getByText('Images')).toBeTruthy();
    expect(screen.getByText('PDFs')).toBeTruthy();
    expect(screen.getByText('Links')).toBeTruthy();
  });

  it('derives the outline from the editor document', () => {
    renderPanel(makeEditor());
    expect(screen.getByText('Section A')).toBeTruthy();
  });

  it('shows empty states for sections with no items', () => {
    renderPanel(makeEditor());
    expect(screen.getByText('No images')).toBeTruthy();
    expect(screen.getByText('No PDFs')).toBeTruthy();
    expect(screen.getByText('No links')).toBeTruthy();
  });

  it('renders the panel shell even when editor is null', () => {
    const { container } = renderPanel(null);
    expect(container.querySelector('.doc-panel')).not.toBeNull();
  });

  it('highlights the heading the scroll-spy reports as in view', () => {
    renderPanel(makeEditor());
    expect(ioObserved.length).toBeGreaterThan(0);
    act(() => {
      ioCallback?.([{ target: ioObserved[0] as Element, isIntersecting: true }]);
    });
    expect(screen.getByText('Section A').getAttribute('aria-current')).toBe('true');
  });

  it('picks the topmost visible heading and clears it when it leaves view', () => {
    renderPanel(makeTwoHeadingEditor());
    expect(ioObserved.length).toBe(2);
    // Both headings intersecting → Math.min picks index 0 (Section A).
    act(() => {
      ioCallback?.([
        { target: ioObserved[0] as Element, isIntersecting: true },
        { target: ioObserved[1] as Element, isIntersecting: true },
      ]);
    });
    expect(screen.getByText('Section A').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Section B').getAttribute('aria-current')).toBeNull();
    // Section A leaves view → only Section B remains visible (delete branch).
    act(() => {
      ioCallback?.([{ target: ioObserved[0] as Element, isIntersecting: false }]);
    });
    expect(screen.getByText('Section A').getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Section B').getAttribute('aria-current')).toBe('true');
  });

  it('re-derives the lists after a debounced editor update', () => {
    vi.useFakeTimers();
    try {
      const editor = makeEditor();
      renderPanel(editor);
      expect(screen.queryByText('Added Later')).toBeNull();
      act(() => {
        editor.commands.insertContentAt(editor.state.doc.content.size, {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Added Later' }],
        });
        // The update event schedules a 300ms debounce — advance past it.
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByText('Added Later')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-derive before the debounce window elapses', () => {
    vi.useFakeTimers();
    try {
      const editor = makeEditor();
      renderPanel(editor);
      act(() => {
        editor.commands.insertContentAt(editor.state.doc.content.size, {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Too Soon' }],
        });
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText('Too Soon')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('jumps the editor selection when an outline row is clicked', () => {
    const editor = makeEditor();
    renderPanel(editor);
    fireEvent.click(screen.getByText('Section A'));
    expect(editor.state.selection.$from.parent.type.name).toBe('heading');
  });

  it('makes a node selection when an image asset row is clicked', () => {
    const editor = makeImageEditor();
    renderPanel(editor);
    fireEvent.click(screen.getByText('A diagram'));
    expect(isNodeSelection(editor.state.selection)).toBe(true);
  });

  it('invokes onCollapse when the collapse button is clicked', () => {
    const onCollapse = vi.fn();
    renderPanel(makeEditor(), onCollapse);
    fireEvent.click(screen.getByLabelText('Hide document panel'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
