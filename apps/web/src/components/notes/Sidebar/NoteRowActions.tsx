'use client';

import { useTranslations } from 'next-intl';
import { noteInternalUrl } from '@/lib/notes/internal-url.ts';
import { CopyLinkButton } from './CopyLinkButton.tsx';

type Props = {
  noteId: string;
  /** Drives the share-button visibility (always-on when > 0 — same cue as folder rows). */
  shareCount: number;
  /** Open inline rename in the parent row. Undefined hides the rename button. */
  onRequestRename?: (() => void) | undefined;
  /** Duplicate the note. Undefined hides the duplicate button. */
  onDuplicate?: (() => void) | undefined;
  /** Open the share dialog for this note. */
  onShare: () => void;
};

const ICON_BASE =
  'text-muted-foreground/50 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-[10px]';
const REVEAL_ON_HOVER = 'opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100';

/**
 * In-flow action strip for a sidebar note row.
 *
 * Lives as a flex sibling of the row's clickable label so the buttons never
 * overlap a long title (the previous `absolute right-1 top-1` group did). The
 * layout mirrors `FolderTree.tsx`'s folder-row actions: `shrink-0` strip,
 * `mt-1` to align with the title's first line, hover-reveal opacity. The
 * share icon stays visible when `shareCount > 0` as an at-a-glance cue.
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

  return (
    <div className="mt-1 flex shrink-0 items-center gap-0.5 pr-1">
      {onRequestRename ? (
        <button
          type="button"
          aria-label={tNA('renameNote')}
          title={tNA('renameNote')}
          onClick={onRequestRename}
          className={`${ICON_BASE} ${REVEAL_ON_HOVER}`}
        >
          <span aria-hidden="true">✎</span>
        </button>
      ) : null}
      {onDuplicate ? (
        <button
          type="button"
          aria-label={tNA('duplicateNote')}
          title={tNA('duplicateNote')}
          onClick={onDuplicate}
          className={`${ICON_BASE} ${REVEAL_ON_HOVER}`}
        >
          <span aria-hidden="true">⎘</span>
        </button>
      ) : null}
      <CopyLinkButton
        path={noteInternalUrl(noteId)}
        label={tNA('copyLink')}
        copiedLabel={tNA('copyLinkCopied')}
        className={`${ICON_BASE} ${REVEAL_ON_HOVER}`}
      />
      <button
        type="button"
        aria-label={tShare('shareNoteLabel')}
        title={tShare('shareNoteLabel')}
        onClick={onShare}
        className={`${ICON_BASE} transition-colors ${shareCount > 0 ? '' : REVEAL_ON_HOVER}`}
      >
        <span aria-hidden="true">👁</span>
      </button>
    </div>
  );
}
