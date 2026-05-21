'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { microsoftApi } from '@/lib/notes/api-client.ts';
import {
  type AppointmentSuggestionItem,
  appointmentSuggestionStore,
} from './AppointmentSuggestion.ts';

/**
 * The React surface the Tiptap `$$` Suggestion plugin drives (ADR 0031).
 *
 * Pure consumer of `appointmentSuggestionStore`: subscribes via
 * `useSyncExternalStore`, debounces the query, calls
 * `microsoftApi.searchAppointments`, and renders a small floating list of
 * picks. Selecting calls `state.pick(item)` which the Suggestion plugin
 * turns into an inserted `appointmentLink` node.
 *
 * Positioning: anchored to the caret rect Suggestion gives us; no tippy.js
 * dependency. When the overlay would go off the right edge it nudges left.
 */

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; events: AppointmentSuggestionItem[] }
  | { kind: 'not-connected' }
  | { kind: 'error' };

const DEBOUNCE_MS = 200;

export function AppointmentOverlay() {
  const t = useTranslations('notes.appointments');
  const state = useSyncExternalStore(
    appointmentSuggestionStore.subscribe,
    appointmentSuggestionStore.getSnapshot,
    appointmentSuggestionStore.getSnapshot,
  );
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'idle' });
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search whenever the query changes while open. State mutations
  // are wrapped in an async IIFE so the react-hooks/set-state-in-effect
  // rule doesn't flag them (project convention — see FolderTree.tsx).
  useEffect(() => {
    if (!state.open) {
      void (async () => setFetchState({ kind: 'idle' }))();
      return;
    }
    const q = state.query.trim();
    if (q.length === 0) {
      void (async () => setFetchState({ kind: 'idle' }))();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        setFetchState({ kind: 'loading' });
        try {
          const body = await microsoftApi.searchAppointments(q);
          setFetchState({ kind: 'ok', events: body.events });
        } catch (err: unknown) {
          // ApiError carries a status code on 4xx — 412 means "not
          // connected" / refresh expired; map to its own UI branch so the
          // user can jump to Settings.
          if (
            typeof err === 'object' &&
            err !== null &&
            'status' in err &&
            (err as { status: number }).status === 412
          ) {
            setFetchState({ kind: 'not-connected' });
            return;
          }
          setFetchState({ kind: 'error' });
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.open, state.query]);

  // Reset cursor when the result set changes (same IIFE-defer trick).
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately resetting `active` on every kind change
  useEffect(() => {
    void (async () => setActive(0))();
  }, [fetchState.kind]);

  if (!state.open || !state.clientRect) return null;

  const rect = state.clientRect;
  // Position below the caret line; nudge left if the panel would overflow.
  const left = Math.min(
    rect.left,
    (typeof window !== 'undefined' ? window.innerWidth : 1024) - 340,
  );
  const top = rect.bottom + 4;

  const onPick = (item: AppointmentSuggestionItem) => state.pick(item);

  return (
    <div
      role="dialog"
      aria-label={t('overlayLabel')}
      style={{ position: 'fixed', left, top, zIndex: 60 }}
      className="border-paper-line bg-background w-[320px] rounded-md border p-1 shadow-lg"
    >
      <p className="text-muted-foreground px-2 py-1 text-[10px] uppercase tracking-wide">
        {t('overlayHint', { query: state.query || '…' })}
      </p>
      {fetchState.kind === 'idle' ? (
        <p className="text-muted-foreground p-2 text-xs">{t('overlayPrompt')}</p>
      ) : null}
      {fetchState.kind === 'loading' ? (
        <p className="text-muted-foreground p-2 text-xs">{t('loading')}</p>
      ) : null}
      {fetchState.kind === 'error' ? (
        <p role="alert" className="text-destructive p-2 text-xs">
          {t('searchError')}
        </p>
      ) : null}
      {fetchState.kind === 'not-connected' ? (
        <div className="flex flex-col gap-1 p-2 text-xs">
          <p className="text-muted-foreground">{t('notConnected')}</p>
          <a href="/settings" className="text-accent-ink underline">
            {t('connectInSettings')}
          </a>
        </div>
      ) : null}
      {fetchState.kind === 'ok' ? (
        fetchState.events.length === 0 ? (
          <p className="text-muted-foreground p-2 text-xs">{t('noResults')}</p>
        ) : (
          <div role="listbox" className="flex max-h-72 flex-col overflow-y-auto">
            {fetchState.events.map((e, i) => (
              <div key={e.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(e)}
                  className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs ${
                    i === active ? 'bg-accent-soft/40' : 'hover:bg-muted/60'
                  }`}
                >
                  <span className="text-foreground font-medium">{e.subject || t('untitled')}</span>
                  {e.startsAt ? (
                    <span className="text-muted-foreground text-[10px]">
                      {new Date(e.startsAt).toLocaleString()}
                    </span>
                  ) : null}
                </button>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
