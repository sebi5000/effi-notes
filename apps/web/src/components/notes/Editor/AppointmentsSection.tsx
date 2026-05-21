'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { type AppointmentLinkView, appointmentApi } from '@/lib/notes/api-client.ts';
import { AttendeesPopover } from './AttendeesPopover.tsx';

type Props = {
  noteId: string;
  /**
   * Bumped whenever the editor finishes a body save — the parent passes
   * the current `bodyVersion` (or any monotonic counter), and this section
   * refetches whenever it changes so newly-linked appointments appear
   * without a hard reload. Optional — when omitted the list refetches only
   * on mount + when noteId changes.
   */
  refreshKey?: number;
  /** Test seam — pass globalThis.fetch in production. */
  fetcher?: typeof fetch | undefined;
};

/**
 * Right-sidebar section that lists every appointment linked to the current
 * note (ADR 0031). Reads `GET /api/notes/[id]/appointments` (snapshot only —
 * no attendees here). Each row opens the shared AttendeesPopover, which
 * lives-fetches attendees through the viewer's own M365 token; a viewer
 * without a connection sees the row + subject but the popover shows a
 * "Connect Microsoft 365" CTA.
 */
export function AppointmentsSection({ noteId, refreshKey, fetcher }: Props) {
  const t = useTranslations('notes.docPanel');
  const tAppt = useTranslations('notes.appointments');
  const [items, setItems] = useState<ReadonlyArray<AppointmentLinkView>>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    // refreshKey is read here purely to register the dep with biome's
    // useExhaustiveDependencies — its only purpose is to re-trigger this
    // effect when the parent bumps it (after a body save).
    void refreshKey;
    let cancelled = false;
    void (async () => {
      try {
        const body = await appointmentApi.list(noteId, fetcher);
        if (!cancelled) setItems(body.appointments);
      } catch {
        // Section degrades silently to empty — the rest of the panel stays
        // functional. The link/unlink flows in the editor will surface
        // their own errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId, refreshKey, fetcher]);

  return (
    <section className="doc-panel-section">
      <h3 className="doc-panel-heading">{t('appointments')}</h3>
      {items.length === 0 ? (
        <p className="doc-panel-empty">{t('empty.appointments')}</p>
      ) : (
        <ul className="doc-panel-list">
          {items.map((appt) => (
            <li key={appt.id} className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={openId === appt.eventId}
                onClick={() => setOpenId((v) => (v === appt.eventId ? null : appt.eventId))}
                className="doc-panel-link-row"
              >
                <span aria-hidden="true">📅</span>
                <span className="truncate">{appt.subject || tAppt('untitled')}</span>
              </button>
              <AttendeesPopover
                appointmentId={appt.eventId}
                label={tAppt('attendeesLabel', { subject: appt.subject || appt.eventId })}
                open={openId === appt.eventId}
                onClose={() => setOpenId(null)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
