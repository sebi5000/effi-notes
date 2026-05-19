'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShareTtl, UserSearchHit } from '@/lib/api/schemas.ts';
import { usersApi } from '@/lib/notes/api-client.ts';
import { debounce } from '@/lib/notes/debounce.ts';
import { ExpiryPicker } from './ExpiryPicker.tsx';
import { PublicLinkSection } from './PublicLinkSection.tsx';
import { useShares } from './useShares.ts';

type ShareScope = { kind: 'note' | 'folder'; id: string };

type Props = {
  scope: ShareScope;
  canManage: boolean;
  onClose: () => void;
  /** Optional injectable fetcher — passed through to useShares and usersApi for testing. */
  fetcher?: typeof fetch;
};

/**
 * Modal dialog for viewing and managing shares on a note or folder.
 * Rolled as a simple accessible modal (role=dialog + aria-modal) because
 * the repo has no shadcn Dialog primitive yet.
 */
export function ShareDialog({ scope, canManage, onClose, fetcher }: Props) {
  const t = useTranslations('notes.share');
  const { shares, loading, error, create, revoke } = useShares(scope, fetcher);

  // ── Add-people form state ──────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchHit[]>([]);
  const [picked, setPicked] = useState<UserSearchHit | null>(null);
  const [access, setAccess] = useState<'VIEW' | 'EDIT'>('VIEW');
  const [ttl, setTtl] = useState<ShareTtl | undefined>(undefined);
  const [adding, setAdding] = useState(false);

  // Stable debounced search — rebuilt only when fetcher reference changes
  // reason: debounce returns Debounced<[string]> but we store it as a generic ref; cast needed
  const searchDebounced = useRef<{ (q: string): void; cancel: () => void } | null>(null);
  useEffect(() => {
    const fn = debounce((q: string) => {
      if (q.trim().length === 0) {
        setResults([]);
        return;
      }
      void usersApi.search(q, fetcher).then((r) => setResults(r.users));
    }, 300);
    searchDebounced.current = fn;
    return () => fn.cancel();
  }, [fetcher]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setPicked(null);
    searchDebounced.current?.(value);
  }, []);

  const handlePick = useCallback((user: UserSearchHit) => {
    setPicked(user);
    setQuery(user.displayName ?? user.email);
    setResults([]);
  }, []);

  const handleAdd = useCallback(async () => {
    if (!picked) return;
    setAdding(true);
    try {
      await create({ granteeId: picked.id, access, ttl });
      setPicked(null);
      setQuery('');
      setResults([]);
    } finally {
      setAdding(false);
    }
  }, [picked, access, ttl, create]);

  // ── Expiry label helper ────────────────────────────────────────────────
  const expiryLabel = (expiresAt: string | null): string => {
    if (expiresAt === null) return t('forever');
    const d = new Date(expiresAt);
    return `${t('expiresAt')}: ${d.toLocaleDateString()}`;
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" aria-hidden="true" onClick={onClose} />

      {/* Dialog panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        className="fixed inset-x-0 top-1/4 z-50 mx-auto w-full max-w-lg rounded-xl border border-border bg-background shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Error state */}
          {error && (
            <p
              role="alert"
              className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {t('error')}: {error}
            </p>
          )}

          {/* Loading state */}
          {loading && <p className="text-sm text-muted-foreground">{t('loading')}</p>}

          {/* Current access list */}
          {!loading && (
            <section aria-label={t('currentAccess')}>
              {shares.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noShares')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {shares.map((share) => {
                    const name = share.grantee.displayName ?? share.grantee.email;
                    return (
                      <li
                        key={share.id}
                        className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">{name}</span>
                          {share.grantee.displayName && (
                            <span className="text-xs text-muted-foreground">
                              {share.grantee.email}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {expiryLabel(share.expiresAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {share.access}
                          </span>
                          {canManage && (
                            <button
                              type="button"
                              aria-label={`${t('revoke')} ${name}`}
                              onClick={() => void revoke(share.id)}
                              className="rounded px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10"
                            >
                              {t('revoke')}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* Add people — only when canManage */}
          {canManage && (
            <section
              aria-label={t('addPeople')}
              className="flex flex-col gap-3 border-t border-border pt-4"
            >
              {/* User search input */}
              <div className="relative">
                <input
                  type="text"
                  aria-label={t('userSearch')}
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder={t('userSearch')}
                  className="border-input bg-background text-foreground focus:ring-ring w-full rounded border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
                />
                {results.length > 0 && (
                  <ul className="absolute top-full left-0 z-10 mt-1 w-full rounded border border-border bg-background shadow-md">
                    {results.map((user) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => handlePick(user)}
                        >
                          {user.displayName ?? user.email}
                          {user.displayName && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({user.email})
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Access level select */}
              <select
                aria-label={t('access')}
                value={access}
                onChange={(e) => setAccess(e.target.value as 'VIEW' | 'EDIT')}
                className="border-input bg-background text-foreground focus:ring-ring w-full rounded border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
              >
                <option value="VIEW">{t('view')}</option>
                <option value="EDIT">{t('edit')}</option>
              </select>

              {/* Expiry picker */}
              <ExpiryPicker value={ttl} onChange={setTtl} />

              {/* Add button */}
              <button
                type="button"
                aria-label={t('add')}
                disabled={!picked || adding}
                onClick={() => void handleAdd()}
                className="self-end rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {t('add')}
              </button>
            </section>
          )}

          {/* Public link — note-only, managers only (ADR 0028) */}
          {canManage && scope.kind === 'note' && (
            <PublicLinkSection noteId={scope.id} fetcher={fetcher} />
          )}
        </div>
      </div>
    </>
  );
}
