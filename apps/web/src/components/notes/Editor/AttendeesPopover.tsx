'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/**
 * Shared attendee popover for the appointment chip (in-editor) and the
 * DocumentPanel's AppointmentsSection (ADR 0031).
 *
 * Live-fetches `/api/users/me/microsoft/appointments/[id]/attendees` on
 * first open. Three render branches:
 *   - loading:        spinner-style placeholder
 *   - 412 not-connected: "Connect Microsoft 365" CTA → /settings
 *   - happy path:     <ul> of {name, email, response}
 *
 * Outside-click + Escape close, modelled on `CalloutMenu` / `HighlightMenu`.
 * `onMouseDown preventDefault` on the trigger keeps editor focus.
 */

type Attendee = {
  name?: string;
  email?: string;
  response?: string;
};

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; attendees: Attendee[] }
  | { kind: 'not-connected' }
  | { kind: 'error' };

type ApiResponse = {
  attendees?: Attendee[];
  error?: string;
};

export type AttendeesPopoverProps = {
  appointmentId: string;
  /** Localised label used for `aria-label` on the popover surface. */
  label: string;
  open: boolean;
  onClose: () => void;
  /** Test seam — pass globalThis.fetch in production. */
  fetcher?: typeof fetch | undefined;
};

export function AttendeesPopover({
  appointmentId,
  label,
  open,
  onClose,
  fetcher,
}: AttendeesPopoverProps) {
  const t = useTranslations('notes.appointments');
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<FetchState>({ kind: 'idle' });

  // Fetch on the first open per mount; refetch if the appointmentId changes
  // while the popover is open (rare but cheap to support). Setting state is
  // wrapped in an async IIFE so the react-hooks/set-state-in-effect rule
  // doesn't flag it (same pattern used elsewhere in the editor code).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setState({ kind: 'loading' });
      const f = fetcher ?? fetch;
      try {
        const res = await f(`/api/users/me/microsoft/appointments/${appointmentId}/attendees`);
        if (cancelled) return;
        if (res.status === 412) {
          setState({ kind: 'not-connected' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = (await res.json()) as ApiResponse;
        setState({ kind: 'ok', attendees: body.attendees ?? [] });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, appointmentId, fetcher]);

  // Outside-click + Escape close. Both are scoped to the open state so we
  // don't keep listeners pinned to window when the popover is invisible.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={label}
      className="border-paper-line bg-background absolute z-30 mt-1 min-w-[16rem] max-w-[20rem] rounded-md border p-2 shadow-lg"
    >
      {state.kind === 'loading' ? (
        <p className="text-muted-foreground p-2 text-xs">{t('loading')}</p>
      ) : null}
      {state.kind === 'error' ? (
        <p role="alert" className="text-destructive p-2 text-xs">
          {t('fetchError')}
        </p>
      ) : null}
      {state.kind === 'not-connected' ? (
        <div className="flex flex-col gap-2 p-2 text-xs">
          <p className="text-muted-foreground">{t('notConnected')}</p>
          <a href="/settings" className="text-accent-ink underline">
            {t('connectInSettings')}
          </a>
        </div>
      ) : null}
      {state.kind === 'ok' ? (
        state.attendees.length === 0 ? (
          <p className="text-muted-foreground p-2 text-xs">{t('noAttendees')}</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto p-1">
            {state.attendees.map((a, i) => (
              <li
                // Email is the natural id but may be missing on resources —
                // fall back to index. The list is rebuilt on every open so
                // a list-order-key is acceptable here.
                // biome-ignore lint/suspicious/noArrayIndexKey: per-open ephemeral list, fallback when email missing
                key={a.email ?? `attendee-${i}`}
                className="text-foreground flex items-center justify-between gap-2 rounded px-2 py-1 text-xs"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{a.name ?? a.email ?? t('unknownAttendee')}</span>
                  {a.email && a.name ? (
                    <span className="text-muted-foreground text-[10px]">{a.email}</span>
                  ) : null}
                </div>
                {a.response && a.response !== 'none' ? (
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    {t(`response.${a.response}`)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
