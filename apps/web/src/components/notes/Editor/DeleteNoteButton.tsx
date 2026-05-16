'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { ApiError, notesApi } from '@/lib/notes/api-client.ts';

type Props = {
  noteId: string;
  noteTitle: string;
  /** Called with a user-facing message when the delete request fails. */
  onError: (message: string) => void;
};

/**
 * Hard-deletes the current note after an explicit `window.confirm`, then
 * navigates back to the note index. A failed delete keeps the user on the
 * note and reports the message via `onError`. Styled like CopyMarkdownButton —
 * small and unobtrusive — with a danger-red hover for the destructive action.
 */
export function DeleteNoteButton({ noteId, noteTitle, onError }: Props) {
  const t = useTranslations('notes.editorActions');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = useCallback(async () => {
    if (!window.confirm(t('confirmDelete', { title: noteTitle }))) return;
    setBusy(true);
    try {
      await notesApi.delete(noteId);
      router.push('/notes');
    } catch (err) {
      setBusy(false);
      onError(err instanceof ApiError ? err.message : t('deleteFailed'));
    }
  }, [noteId, noteTitle, onError, router, t]);

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy}
      aria-label={t('delete')}
      title={t('delete')}
      className="text-muted-foreground/50 hover:text-danger inline-flex items-center rounded text-xs transition-colors"
    >
      <span aria-hidden="true" className="text-sm leading-none">
        ✕
      </span>
    </button>
  );
}
