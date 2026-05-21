'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AttendeesPopover } from './AttendeesPopover.tsx';

/**
 * NodeView for the inline `appointmentLink` Tiptap node (ADR 0031). Renders
 * a compact 📅-prefixed pill carrying the cached subject; clicking opens the
 * shared `AttendeesPopover` which live-fetches the attendees through the
 * VIEWER's own M365 token. A viewer without M365 sees the chip + subject
 * normally; the popover shows "Connect Microsoft 365".
 */
export function AppointmentChip({ node }: NodeViewProps) {
  const t = useTranslations('notes.appointments');
  const [open, setOpen] = useState(false);
  const appointmentId = String(node.attrs.appointmentId ?? '');
  const subject = String(node.attrs.subject ?? '');

  return (
    <NodeViewWrapper
      as="span"
      className="note-appointment-chip relative inline-block"
      data-testid="appointment-chip"
    >
      <button
        type="button"
        aria-label={t('chipLabel', { subject: subject || appointmentId })}
        aria-haspopup="dialog"
        aria-expanded={open}
        // preventDefault keeps the editor selection where it was so the
        // popover doesn't move the caret.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="border-paper-line bg-accent-soft/30 text-foreground hover:bg-accent-soft/50 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-sm leading-tight"
      >
        <span aria-hidden="true">📅</span>
        <span>{subject || t('untitled')}</span>
      </button>
      {appointmentId ? (
        <AttendeesPopover
          appointmentId={appointmentId}
          label={t('attendeesLabel', { subject: subject || appointmentId })}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </NodeViewWrapper>
  );
}
