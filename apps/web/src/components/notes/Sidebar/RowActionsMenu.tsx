'use client';

import { useEffect, useRef, useState } from 'react';

export type RowMenuItem = {
  /** Unique key per menu item (stable across renders). */
  key: string;
  /**
   * Localised label shown in the menu — also used as `aria-label` so existing
   * tests/automations that query by "Rename note", "Share note" etc. keep
   * working once the menu is open.
   */
  label: string;
  /** Optional leading glyph (emoji); purely decorative. */
  icon?: string;
  /** Run when the item is selected. The menu auto-closes after. */
  onSelect: () => void;
  /** Styles the item in danger colours (e.g. delete). */
  destructive?: boolean;
};

type Props = {
  /** Accessible label for the trigger (e.g. "More actions"). */
  triggerLabel: string;
  items: ReadonlyArray<RowMenuItem>;
  /** Marks the trigger with a small dot — e.g. for "this row is shared". */
  badge?: boolean;
};

/**
 * Single-trigger dropdown that consolidates a row's action buttons into one
 * compact ▾ button so the sidebar can show more content. Modeled on
 * `Editor/CalloutMenu.tsx`: outside-click + Escape close, `role="menu"`,
 * children use `role="menuitem"`. When no items would be visible the trigger
 * is hidden entirely.
 */
export function RowActionsMenu({ triggerLabel, items, badge = false }: Props) {
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

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          // Don't bubble into the row's onClick (which would select the row).
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`text-muted-foreground/60 hover:text-foreground relative inline-flex h-5 w-5 items-center justify-center rounded text-[10px] transition-colors ${
          open ? 'text-foreground bg-muted/70' : ''
        }`}
      >
        <span aria-hidden="true">▾</span>
        {badge ? (
          <span
            aria-hidden="true"
            className="bg-accent absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={triggerLabel}
          className="border-paper-line bg-background absolute right-0 top-full z-30 mt-1 min-w-[10rem] rounded-md border p-1 shadow-lg"
          onClick={(e) => {
            // Prevent row-selection when interacting with the menu surface.
            e.stopPropagation();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-label={item.label}
              onClick={(e) => {
                e.stopPropagation();
                item.onSelect();
                setOpen(false);
              }}
              className={`hover:bg-muted/60 flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1 text-left text-xs ${
                item.destructive ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {item.icon !== undefined ? (
                <span
                  aria-hidden="true"
                  className="text-muted-foreground/70 inline-block w-3 text-center"
                >
                  {item.icon}
                </span>
              ) : null}
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
