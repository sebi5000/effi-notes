'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ShareTtl } from '@/lib/api/schemas.ts';
import { useCopyToClipboard } from '@/lib/notes/use-copy-to-clipboard.ts';
import { ExpiryPicker } from './ExpiryPicker.tsx';
import { usePublicLink } from './usePublicLink.ts';

type Props = {
  /** Id of the note this section manages a public link for. */
  noteId: string;
  /** Optional injectable fetcher — passed through to usePublicLink for tests. */
  fetcher?: typeof fetch | undefined;
};

/**
 * The "Public link" block of the Share dialog (ADR 0028) — note-only.
 *
 * With no link: an optional-expiry picker + a "Generate" button. With a link:
 * the absolute URL, a copy button, the expiry, and a revoke button.
 * Regenerating means revoke-then-generate, so only revoke is offered while a
 * link exists.
 */
export function PublicLinkSection({ noteId, fetcher }: Props) {
  const t = useTranslations('notes.share');
  const { link, error, generate, revoke } = usePublicLink(noteId, fetcher);
  const [ttl, setTtl] = useState<ShareTtl | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  // The dialog only ever mounts client-side (behind user state), so `window`
  // is always defined here.
  const fullUrl = link ? `${window.location.origin}${link.url}` : '';

  const run = async (op: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await op();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-border flex flex-col gap-2 border-t pt-4">
      <h3 className="text-foreground text-sm font-semibold">{t('publicLinkHeading')}</h3>
      <p className="text-muted-foreground text-xs">{t('publicLinkDescription')}</p>

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {t('error')}: {error}
        </p>
      ) : null}

      {link ? (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              aria-label={t('publicLinkHeading')}
              value={fullUrl}
              className="border-input bg-muted text-foreground flex-1 rounded border px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => void copy(fullUrl)}
              className="bg-primary text-primary-foreground rounded px-3 py-1 text-xs font-medium"
            >
              {copied ? t('publicLinkCopied') : t('publicLinkCopy')}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">
              {link.expiresAt === null
                ? t('forever')
                : `${t('expiresAt')}: ${new Date(link.expiresAt).toLocaleDateString()}`}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(revoke)}
              className="text-destructive hover:bg-destructive/10 rounded px-2 py-0.5 text-xs disabled:opacity-50"
            >
              {t('publicLinkRevoke')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-foreground text-xs font-medium">{t('expiryHeading')}</span>
            <ExpiryPicker value={ttl} onChange={setTtl} />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => generate(ttl ? { ttl } : {}))}
            className="bg-primary text-primary-foreground self-start rounded px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {t('publicLinkGenerate')}
          </button>
        </>
      )}
    </section>
  );
}
