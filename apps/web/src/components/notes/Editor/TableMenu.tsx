'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Props = {
  editor: Editor;
};

/** One menu operation: an i18n key, the command to run, the can-run check. */
type TableOp = { key: string; run: () => void; can: () => boolean };

/**
 * Toolbar control for tables. Outside a table the button inserts a 3x3 table
 * with a header row. Inside a table it opens a dropdown of operations,
 * grouped (rows / columns / table); each item is disabled when its command is
 * not currently valid. Modelled on `CalloutMenu` — owns only its open state,
 * closes on Escape and outside-click.
 */
export function TableMenu({ editor }: Props) {
  const t = useTranslations('notes.editorTable');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inTable = editor.isActive('table');

  // When the cursor leaves a table, drop a stale-open menu so it does not
  // re-appear unbidden on the next table the cursor enters. This is React's
  // render-phase "adjust state when a prop changes" pattern — not an effect,
  // so it is not subject to react-hooks/set-state-in-effect.
  const [wasInTable, setWasInTable] = useState(inTable);
  if (wasInTable !== inTable) {
    setWasInTable(inTable);
    if (!inTable && open) setOpen(false);
  }

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

  const onButtonClick = () => {
    if (inTable) {
      setOpen((v) => !v);
    } else {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }
  };

  const groups: TableOp[][] = [
    [
      {
        key: 'rowAbove',
        run: () => editor.chain().focus().addRowBefore().run(),
        can: () => editor.can().addRowBefore(),
      },
      {
        key: 'rowBelow',
        run: () => editor.chain().focus().addRowAfter().run(),
        can: () => editor.can().addRowAfter(),
      },
      {
        key: 'deleteRow',
        run: () => editor.chain().focus().deleteRow().run(),
        can: () => editor.can().deleteRow(),
      },
    ],
    [
      {
        key: 'columnLeft',
        run: () => editor.chain().focus().addColumnBefore().run(),
        can: () => editor.can().addColumnBefore(),
      },
      {
        key: 'columnRight',
        run: () => editor.chain().focus().addColumnAfter().run(),
        can: () => editor.can().addColumnAfter(),
      },
      {
        key: 'deleteColumn',
        run: () => editor.chain().focus().deleteColumn().run(),
        can: () => editor.can().deleteColumn(),
      },
    ],
    [
      {
        key: 'toggleHeader',
        run: () => editor.chain().focus().toggleHeaderRow().run(),
        can: () => editor.can().toggleHeaderRow(),
      },
      {
        key: 'deleteTable',
        run: () => editor.chain().focus().deleteTable().run(),
        can: () => editor.can().deleteTable(),
      },
    ],
  ];

  const pick = (op: TableOp) => {
    op.run();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('insertTable')}
        title={t('insertTable')}
        // Dual-mode button: outside a table it inserts (no popup); inside a
        // table it opens the operations menu. The popup ARIA is therefore
        // only present when the menu can actually open.
        aria-haspopup={inTable ? 'menu' : undefined}
        aria-expanded={inTable ? open : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onButtonClick}
        className={`hover:bg-muted inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm transition-colors ${
          inTable ? 'bg-accent text-white' : 'text-foreground'
        }`}
      >
        <span aria-hidden="true">▦</span>
      </button>
      {inTable && open ? (
        <div
          role="menu"
          aria-label={t('insertTable')}
          className="border-paper-line bg-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border p-1 shadow-lg"
        >
          {groups.map((group, groupIndex) => (
            <div
              key={group[0]?.key}
              className={groupIndex > 0 ? 'border-paper-line/60 mt-1 border-t pt-1' : ''}
            >
              {group.map((op) => (
                <button
                  key={op.key}
                  type="button"
                  role="menuitem"
                  disabled={!op.can()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(op)}
                  className="hover:bg-muted flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t(op.key)}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
