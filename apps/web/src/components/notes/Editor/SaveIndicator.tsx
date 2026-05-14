'use client';

import { useTranslations } from 'next-intl';
import type { SaveState } from '@/lib/notes/save-state.ts';

/**
 * Small lozenge in the editor footer reflecting the current SaveState.
 * Pure presentational — the state machine lives in save-state.ts so the
 * indicator is easy to unit-test.
 */
type Props = {
  state: SaveState;
  viewerCount: number;
};

const dotClass: Record<SaveState, string> = {
  idle: 'bg-paper-line',
  dirty: 'bg-accent',
  saving: 'bg-accent-soft animate-pulse',
  saved: 'bg-accent-ink',
  conflict: 'bg-danger',
  offline: 'bg-muted-foreground animate-pulse',
};

export function SaveIndicator({ state, viewerCount }: Props) {
  const t = useTranslations('notes.saveIndicator');
  const label = t(state);
  const viewers = viewerCount > 1 ? t('viewing', { count: viewerCount }) : null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-state={state}
      className="text-muted-foreground font-body inline-flex items-center gap-2 text-xs"
    >
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${dotClass[state]}`} />
      <span>{label}</span>
      {viewers ? <span className="text-muted-foreground/80">· {viewers}</span> : null}
    </div>
  );
}
