'use client';

import { useTranslations } from 'next-intl';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { FOLDER_ICONS, type FolderIcon as FolderIconKey } from '@/lib/notes/folder-icons.ts';
import { FolderIcon } from './FolderIcon.tsx';

type Props = {
  /** The trigger's bounding rect — the popover anchors below it. */
  anchorRect: DOMRect;
  /** The folder's current icon key — its grid cell is marked active. */
  current: string;
  onPick: (icon: FolderIconKey) => void;
  onClose: () => void;
};

/** Grid width — 6 columns. Used for vertical arrow-key navigation. */
const COLUMNS = 6;

/**
 * A small popover grid of the curated folder icons. Hand-rolled (no Radix):
 * it portals into `document.body` and positions itself `fixed` at the
 * trigger's rect, so the sidebar's `overflow-y-auto` cannot clip it. Closes on
 * Escape, an outside pointer-down, or a scroll/resize that would move the
 * anchor; arrow keys move focus across the grid.
 */
export function FolderIconPicker({ anchorRect, current, onPick, onClose }: Props) {
  const t = useTranslations('notes.folderIcons');
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus the active icon (or the first) when the popover opens.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const active = panel.querySelector<HTMLButtonElement>('button[data-active="true"]');
    const first = panel.querySelector<HTMLButtonElement>('button[data-icon]');
    (active ?? first)?.focus();
  }, []);

  // Close on an outside pointer-down. Deferred one tick so the click that
  // opened the popover does not immediately close it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCloseRef.current();
    };
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  // The anchor moves if the page scrolls or resizes — close rather than chase.
  useEffect(() => {
    const close = () => onCloseRef.current();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    const delta =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? COLUMNS
            : e.key === 'ArrowUp'
              ? -COLUMNS
              : 0;
    if (delta === 0) return;
    e.preventDefault();
    const panel = panelRef.current;
    if (panel === null) return;
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button[data-icon]')];
    const here = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[here + delta]?.focus();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('pickerLabel')}
      onKeyDown={onKeyDown}
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      className="border-paper-line/80 bg-background fixed z-50 grid w-[232px] grid-cols-6 gap-1 rounded-lg border p-2 shadow-lg"
    >
      {FOLDER_ICONS.map((key) => {
        const isActive = key === current;
        return (
          <button
            key={key}
            type="button"
            data-icon={key}
            data-active={isActive}
            aria-label={t(`names.${key}`)}
            aria-pressed={isActive}
            onClick={() => onPick(key)}
            className={`inline-flex aspect-square items-center justify-center rounded transition-colors ${
              isActive ? 'bg-accent-soft/60 ring-accent ring-1' : 'hover:bg-muted/60'
            }`}
          >
            <FolderIcon icon={key} className="h-4 w-4" />
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
