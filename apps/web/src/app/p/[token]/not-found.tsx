import { getTranslations } from 'next-intl/server';

/**
 * Shown when `/p/[token]` calls `notFound()` — a malformed, unknown, expired,
 * revoked, or archived public link. Deliberately gives no detail (ADR 0028).
 */
export default async function PublicNoteNotFound() {
  const t = await getTranslations('public');
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="font-display text-foreground text-2xl font-semibold">{t('notFoundTitle')}</h1>
      <p className="text-muted-foreground text-sm">{t('notFoundBody')}</p>
    </main>
  );
}
