'use client';

import type { Editor } from '@tiptap/core';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type DocItems, deriveDocItems } from '@/lib/notes/doc-outline.ts';
import { AssetSection } from './AssetSection.tsx';
import { LinksSection } from './LinksSection.tsx';
import { OutlineSection } from './OutlineSection.tsx';

const EMPTY: DocItems = { headings: [], images: [], pdfs: [], links: [] };

type Props = { editor: Editor | null; onCollapse: () => void };

/**
 * The document panel container. Derives the heading/image/PDF/link lists from
 * the live editor document (re-derived, debounced, on every editor update),
 * runs the outline scroll-spy, and handles click-to-jump. The section
 * components below it are purely presentational.
 */
export function DocumentPanel({ editor, onCollapse }: Props) {
  const t = useTranslations('notes.docPanel');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // A monotonically increasing counter bumped on each (debounced) editor
  // update — the derivation re-runs whenever this changes. Tracking a version
  // rather than storing `DocItems` in state keeps the effect free of a
  // synchronous setState (which the React-Compiler lint forbids).
  const [docVersion, setDocVersion] = useState(0);
  const [activeHeading, setActiveHeading] = useState(-1);

  // Re-derive the lists from the live document. `docVersion` is the only
  // moving input: it bumps on editor updates, so a doc edit re-runs this, and
  // an `editor` swap re-runs it too. Derivation itself is pure (doc-outline).
  const items = useMemo<DocItems>(() => {
    // `docVersion` is read so the memo re-derives when the document changes.
    void docVersion;
    return editor ? deriveDocItems(editor.state.doc, origin) : EMPTY;
  }, [editor, origin, docVersion]);

  // Subscribe to editor updates and bump the version, debounced so a burst of
  // keystrokes does not re-walk the document on every character. No state is
  // set synchronously here — only from the debounced timer callback.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setDocVersion((v) => v + 1), 300);
    };
    editor.on('update', onUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off('update', onUpdate);
    };
  }, [editor]);

  // Scroll-spy: highlight the heading whose section is in the top of the
  // viewport. Re-observes when the heading set changes. `activeHeading` is
  // only ever set from the async IntersectionObserver callback, never
  // synchronously in the effect body.
  useEffect(() => {
    if (!editor || items.headings.length === 0) return;
    const els = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    if (els.length === 0) return;
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = els.indexOf(entry.target as HTMLElement);
          if (idx < 0) continue;
          if (entry.isIntersecting) visible.add(idx);
          else visible.delete(idx);
        }
        if (visible.size > 0) setActiveHeading(Math.min(...visible));
      },
      { rootMargin: '0px 0px -75% 0px' },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [editor, items.headings]);

  // Clamp the active index to the current heading list during render so a
  // stale value (left over after headings were removed) never marks a row
  // that no longer exists — and resolves to -1 when there are no headings.
  const activeIndex = activeHeading < items.headings.length ? activeHeading : -1;

  const handleSelect = useCallback(
    (pos: number) => {
      if (!editor) return;
      const node = editor.state.doc.nodeAt(pos);
      // Atom nodes (image, pdfChip) need a node selection; headings — which
      // have editable text content — take a text selection at their position.
      if (node?.isAtom) {
        editor.chain().focus().setNodeSelection(pos).scrollIntoView().run();
      } else {
        editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
      }
    },
    [editor],
  );

  return (
    <aside className="doc-panel relative" aria-label={t('title')}>
      <button
        type="button"
        aria-label={t('hide')}
        title={t('hide')}
        onClick={onCollapse}
        className="text-muted-foreground/60 hover:text-foreground absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-sm leading-none"
      >
        <span aria-hidden="true">»</span>
      </button>
      <OutlineSection headings={items.headings} activeIndex={activeIndex} onSelect={handleSelect} />
      <AssetSection
        title={t('images')}
        emptyText={t('empty.images')}
        items={items.images}
        onSelect={handleSelect}
      />
      <AssetSection
        title={t('pdfs')}
        emptyText={t('empty.pdfs')}
        items={items.pdfs}
        onSelect={handleSelect}
      />
      <LinksSection links={items.links} origin={origin} />
    </aside>
  );
}
