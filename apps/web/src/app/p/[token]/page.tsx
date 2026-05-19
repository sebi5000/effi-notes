import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { publicLinkTokenSchema } from '@/lib/api/schemas.ts';
import { resolvePublicNote } from '@/lib/notes/public-link.ts';
import { renderNoteHtml } from '@/lib/notes/render-note.ts';
import { clientIpFromHeaders, rateLimit } from '@/lib/rate-limit.ts';

/**
 * Account-less public note viewer (ADR 0028) at `/p/[token]`.
 *
 * Read-only, rate-limited by IP, and never search-indexed. A missing,
 * malformed, expired, revoked, or archived target all collapse to one
 * `notFound()` — no oracle. The note's rich content is rendered server-side
 * from its Yjs snapshot and sanitised before display.
 */

// Revocation and expiry must take effect immediately — never serve a cached page.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Rewrite an in-app asset URL to the token-scoped public asset route. */
const ASSET_URL = /^\/api\/assets\/([A-Za-z0-9_-]+)$/;

type PageProps = { params: Promise<{ token: string }> };

export default async function PublicNotePage({ params }: PageProps) {
  const { token } = await params;
  const t = await getTranslations('public');

  const ip = clientIpFromHeaders(await headers());
  const limit = await rateLimit({ key: ip, scope: 'public.view', max: 60, windowMs: 60_000 });
  if (!limit.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground text-sm">{t('rateLimited')}</p>
      </main>
    );
  }

  // Reject a malformed token before any DB work; resolvePublicNote also guards.
  if (!publicLinkTokenSchema.safeParse(token).success) notFound();

  const note = await resolvePublicNote(token);
  if (note === null) notFound();

  const html = renderNoteHtml(note.yjsState, note.body, {
    rewriteAssetUrl: (src) => {
      const match = ASSET_URL.exec(src);
      return match ? `/p/${token}/assets/${match[1]}` : src;
    },
  });
  const format = await getFormatter();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="border-paper-line/60 mb-6 border-b pb-4">
        <span className="text-muted-foreground/70 text-xs font-medium uppercase tracking-wide">
          {t('viewOnlyBadge')}
        </span>
        <h1 className="font-display text-foreground mt-1 text-3xl font-semibold">{note.title}</h1>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('updatedAt', { date: format.dateTime(note.updatedAt, { dateStyle: 'medium' }) })}
        </p>
        {note.tags.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {note.tags.map((tag) => (
              <li key={tag.name} className="bg-muted rounded px-2 py-0.5 text-xs">
                {tag.name}
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered, DOMPurify-sanitised note HTML — see lib/notes/render-note.ts (ADR 0028) */}
      <article className="prose-paper" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
