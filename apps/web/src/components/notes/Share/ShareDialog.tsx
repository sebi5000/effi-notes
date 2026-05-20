'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShareTtl, ShareView, UserSearchHit } from '@/lib/api/schemas.ts';
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

          {/* Current access list — active grants grouped first, expired
              underneath so managers can see / revoke history without
              mistaking it for live access (QA review 2026-05-20, P2). */}
          {!loading && <ShareList shares={shares} canManage={canManage} revoke={revoke} />}

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

/**
 * Render the current-access section: active grants on top, expired grants
 * underneath their own heading (and visually dimmed) so a manager can tell
 * at a glance which grants are still live. Expired rows are still
 * revocable — the API surfaces them precisely so the user can clean them
 * up. (QA review 2026-05-20, P2.)
 */
function ShareList({
  shares,
  canManage,
  revoke,
}: {
  shares: ReadonlyArray<ShareView>;
  canManage: boolean;
  revoke: (id: string) => Promise<void>;
}) {
  const t = useTranslations('notes.share');
  const { active, expired } = useMemo(() => {
    const a: ShareView[] = [];
    const e: ShareView[] = [];
    for (const s of shares) (s.status === 'expired' ? e : a).push(s);
    return { active: a, expired: e };
  }, [shares]);

  const expiryLabel = (expiresAt: string | null): string => {
    if (expiresAt === null) return t('forever');
    return `${t('expiresAt')}: ${new Date(expiresAt).toLocaleDateString()}`;
  };

  return (
    <section aria-label={t('currentAccess')} className="flex flex-col gap-4">
      {active.length === 0 && expired.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noShares')}</p>
      ) : null}

      {active.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {active.map((share) => {
            const name = share.grantee.displayName ?? share.grantee.email;
            return (
              <li
                key={share.id}
                className="border-border flex items-center justify-between rounded border px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground font-medium">{name}</span>
                  {share.grantee.displayName ? (
                    <span className="text-muted-foreground text-xs">{share.grantee.email}</span>
                  ) : null}
                  <span className="text-muted-foreground text-xs">
                    {expiryLabel(share.expiresAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                    {share.access}
                  </span>
                  {canManage ? (
                    <button
                      type="button"
                      aria-label={`${t('revoke')} ${name}`}
                      onClick={() => void revoke(share.id)}
                      className="text-destructive hover:bg-destructive/10 rounded px-2 py-0.5 text-xs"
                    >
                      {t('revoke')}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {expired.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-muted-foreground/80 text-xs font-semibold uppercase tracking-wide">
            {t('expiredHeading')}
          </h4>
          <ul className="flex flex-col gap-2">
            {expired.map((share) => {
              const name = share.grantee.displayName ?? share.grantee.email;
              return (
                <li
                  key={share.id}
                  data-status="expired"
                  className="border-border/60 flex items-center justify-between rounded border px-3 py-2 text-sm opacity-70"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground font-medium">{name}</span>
                    {share.grantee.displayName ? (
                      <span className="text-muted-foreground text-xs">{share.grantee.email}</span>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {t('expiredOn', {
                        date: share.expiresAt ? new Date(share.expiresAt).toLocaleDateString() : '',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-muted/60 text-muted-foreground rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                      {t('expiredBadge')}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={`${t('revoke')} ${name}`}
                        onClick={() => void revoke(share.id)}
                        className="text-destructive hover:bg-destructive/10 rounded px-2 py-0.5 text-xs"
                      >
                        {t('revoke')}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
