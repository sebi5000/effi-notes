'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Settings card for the Microsoft 365 / Outlook integration (ADR 0031).
 *
 * Three top-level states:
 *   - `configured === false`         — env vars missing; show "ask admin"
 *   - `configured === true, connected === false` — show "Connect" anchor
 *   - `connected === true`           — show "Connected as upn — Disconnect"
 *
 * Connect uses an anchor (server-side redirect) rather than a fetch, so the
 * browser's URL bar leaves cleanly for Microsoft's consent page. Disconnect
 * is a DELETE on /api/users/me/microsoft.
 */

export type MicrosoftCardProps = {
  configured: boolean;
  /** Present (with optional upn) when configured && connected. */
  initialStatus: { connected: boolean; upn?: string; connectedAt?: string };
  /** Test seam — pass globalThis.fetch in production. */
  fetcher?: typeof fetch | undefined;
};

/**
 * Map the `?microsoft=<status>` query the callback redirects back with into a
 * localised i18n key under `settings.microsoft.callback.<status>`. Any
 * unknown value falls back to a generic error so a typo in the route can't
 * leave the user with a blank banner.
 */
const CALLBACK_STATUS_KEYS: ReadonlyArray<string> = [
  'connected',
  'denied',
  'malformed',
  'bad-state',
  'user-mismatch',
  'token-exchange-failed',
  'no-refresh-token',
  'no-id-token',
  'bad-id-token',
  'not-configured',
  'unauthorised',
];

export function MicrosoftConnectionCard({
  configured,
  initialStatus,
  fetcher,
}: MicrosoftCardProps) {
  const t = useTranslations('settings.microsoft');
  const params = useSearchParams();
  const callbackStatus = params.get('microsoft');
  const callbackKey =
    callbackStatus !== null && CALLBACK_STATUS_KEYS.includes(callbackStatus)
      ? callbackStatus
      : null;

  const [connected, setConnected] = useState(initialStatus.connected);
  const [upn, setUpn] = useState<string | undefined>(initialStatus.upn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const f = fetcher ?? fetch;
      const res = await f('/api/users/me/microsoft', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConnected(false);
      setUpn(undefined);
    } catch {
      setError(t('disconnectFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t('notConfigured')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {callbackKey === 'connected' ? (
        <p
          role="status"
          className="border-accent/40 bg-accent-soft/30 text-foreground rounded border px-3 py-2 text-xs"
        >
          {t('callbackConnected')}
        </p>
      ) : callbackKey !== null ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded border px-3 py-2 text-xs"
        >
          {t(`callback.${callbackKey}`)}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {connected ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-foreground text-sm">
            {upn ? t('connectedAs', { upn }) : t('connectedGeneric')}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void disconnect()}
            className="text-destructive hover:bg-destructive/10 rounded px-3 py-1 text-xs disabled:opacity-50"
          >
            {t('disconnect')}
          </button>
        </div>
      ) : (
        <a
          href="/api/users/me/microsoft/authorize"
          className="bg-primary text-primary-foreground self-start rounded px-3 py-1.5 text-xs font-medium hover:opacity-90"
        >
          {t('connect')}
        </a>
      )}
    </div>
  );
}
