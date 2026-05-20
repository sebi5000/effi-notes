'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

type Props = {
  /** The current note title. */
  title: string;
  /** Called with the trimmed new title when the user commits a changed, non-empty edit. */
  onCommit: (title: string) => void;
};

/**
 * The note title shown above the editor: a heading plus a pencil button that
 * swaps it for an inline input. Enter or blur commits; Escape or an empty /
 * unchanged value cancels. Committing here is a *manual* title set — the
 * caller (NotesShell `handleRenameNote`) flags `titleManuallySet`, which stops
 * the editor's auto-titling.
 */
export function EditableNoteTitle({ title, onCommit }: Props) {
  const t = useTranslations('notes.noteActions');
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <TitleInput
        initial={title}
        label={t('renameNotePlaceholder')}
        onCommit={(value) => {
          const trimmed = value.trim();
          if (trimmed.length > 0 && trimmed !== title) onCommit(trimmed);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <h1 className="font-body text-foreground text-3xl font-semibold">{title}</h1>
      <button
        type="button"
        aria-label={t('renameNote')}
        title={t('renameNote')}
        onClick={() => setEditing(true)}
        className="text-muted-foreground/50 hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm transition-colors"
      >
        <span aria-hidden="true">✎</span>
      </button>
    </div>
  );
}

/** Inline title input — Enter/blur commit, Escape cancels; fires its outcome at most once. */
function TitleInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);

  const commit = (): void => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  const cancel = (): void => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <input
      ref={(el) => {
        if (el) {
          el.focus();
          el.select();
        }
      }}
      type="text"
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={() => commit()}
      className="border-border bg-background text-foreground font-body mb-4 w-full rounded border px-2 py-1 text-3xl font-semibold focus:outline-none"
    />
  );
}
