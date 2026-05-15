'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CALLOUT_TYPES, type CalloutType } from './CalloutExtension.ts';

type Props = {
  editor: Editor;
};

/**
 * Toolbar entry that opens a dropdown of the five callout types. Picking one
 * inserts that callout via the `setCallout` command. Owns only its open/closed
 * state; closes on outside-click and Escape.
 */
export function CalloutMenu({ editor }: Props) {
  const t = useTranslations('notes.callouts');
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

  const insert = (type: CalloutType) => {
    editor.chain().focus().setCallout(type).run();
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
          open ? 'bg-accent text-white' : 'text-foreground'
        }`}
      >
        ▤
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t('label')}
          className="border-paper-line bg-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border p-1 shadow-lg"
        >
          {CALLOUT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(type)}
              className="hover:bg-muted flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm text-foreground"
            >
              <span aria-hidden="true" data-callout={type} className="callout-icon" />
              {t(type)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
