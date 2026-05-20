'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Props = {
  editor: Editor;
};

/**
 * Four highlight colours that read well on both light and dark themes. Each
 * entry pairs a stable id (used as both the React key and the translation
 * sub-key) with the actual CSS colour the Highlight extension will set as
 * the mark's inline `background-color`. Keep the order stable — the swatch
 * row is muscle memory.
 */
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', css: '#fde68a' },
  { id: 'green', css: '#bbf7d0' },
  { id: 'blue', css: '#bfdbfe' },
  { id: 'red', css: '#fecaca' },
] as const;

export type HighlightColorId = (typeof HIGHLIGHT_COLORS)[number]['id'];

/**
 * Toolbar entry that opens a dropdown of four highlight colours (plus a
 * "clear" action that removes any active highlight from the selection).
 * Modeled 1:1 on `CalloutMenu` — owns only its open/closed state, closes
 * on outside-click and Escape, never disrupts the editor selection
 * (`onMouseDown preventDefault` keeps focus where the user left it).
 */
export function HighlightMenu({ editor }: Props) {
  const t = useTranslations('notes.highlight');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // `editor.isActive('highlight')` reports whether the cursor / selection
  // already has the highlight mark — used both to keep the trigger lit and
  // to show the "Clear" item only when there's something to clear.
  const highlightActive = editor.isActive('highlight');

  const apply = (color: string) => {
    editor.chain().focus().setHighlight({ color }).run();
    setOpen(false);
  };
  const clear = () => {
    editor.chain().focus().unsetHighlight().run();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('label')}
        title={t('label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={`hover:bg-muted inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm transition-colors ${
          open || highlightActive ? 'bg-accent text-white' : 'text-foreground'
        }`}
      >
        {/* Glyph hints at "highlight a span of text" — distinct from the
            other toolbar buttons. */}
        <span aria-hidden="true">🖍</span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t('label')}
          className="border-paper-line bg-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border p-1 shadow-lg"
        >
          <div className="flex items-center gap-1 px-1 py-1">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                aria-label={t(c.id)}
                title={t(c.id)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(c.css)}
                className="border-paper-line hover:ring-accent inline-flex h-6 w-6 items-center justify-center rounded-full border hover:ring-2"
                style={{ backgroundColor: c.css }}
              />
            ))}
          </div>
          {highlightActive ? (
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              className="hover:bg-muted text-foreground flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm"
            >
              {t('clear')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
