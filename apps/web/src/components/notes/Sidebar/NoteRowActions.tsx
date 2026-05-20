'use client';

import { useTranslations } from 'next-intl';
import { noteInternalUrl } from '@/lib/notes/internal-url.ts';
import { useCopyToClipboard } from '@/lib/notes/use-copy-to-clipboard.ts';
import { RowActionsMenu, type RowMenuItem } from './RowActionsMenu.tsx';

type Props = {
  noteId: string;
  /** Drives the trigger's "shared" badge (always-on cue when > 0). */
  shareCount: number;
  /** Open inline rename in the parent row. Undefined hides the rename item. */
  onRequestRename?: (() => void) | undefined;
  /** Duplicate the note. Undefined hides the duplicate item. */
  onDuplicate?: (() => void) | undefined;
  /** Open the share dialog for this note. */
  onShare: () => void;
};

/**
 * Collapses every per-row action into a single ▾ dropdown so the sidebar can
 * show more title + snippet. The menu items keep their original accessible
 * labels (rename, duplicate, copy link, share) — only the trigger changes.
 */
export function NoteRowActions({
  noteId,
  shareCount,
  onRequestRename,
  onDuplicate,
  onShare,
}: Props) {
  const tNA = useTranslations('notes.noteActions');
  const tShare = useTranslations('notes.share');
  const { copy } = useCopyToClipboard();

  const items: RowMenuItem[] = [];
  if (onRequestRename) {
    items.push({
      key: 'rename',
      icon: '✎',
      label: tNA('renameNote'),
      onSelect: onRequestRename,
    });
  }
  if (onDuplicate) {
    items.push({
      key: 'duplicate',
      icon: '⎘',
      label: tNA('duplicateNote'),
      onSelect: onDuplicate,
    });
  }
  items.push({
    key: 'copy',
    icon: '🔗',
    label: tNA('copyLink'),
    onSelect: () => {
      // Absolute URL composed at click time so the component is safe to SSR.
      void copy(`${window.location.origin}${noteInternalUrl(noteId)}`);
    },
  });
  items.push({
    key: 'share',
    icon: '👁',
    label: tShare('shareNoteLabel'),
    onSelect: onShare,
  });

  return (
    <div className="mt-1 flex shrink-0 items-center pr-1">
      <RowActionsMenu triggerLabel={tNA('moreActions')} items={items} badge={shareCount > 0} />
    </div>
  );
}
