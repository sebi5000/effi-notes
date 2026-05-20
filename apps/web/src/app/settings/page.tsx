import { prisma } from '@app/db';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { ThemeCardGrid } from '@/components/settings/ThemeCardGrid.tsx';
import { UserMenu } from '@/components/UserMenu.tsx';
import { DEFAULT_THEME, isThemeId } from '@/lib/theme/themes.ts';

/**
 * Account settings — currently the theme picker (ADR 0029). Middleware
 * guards `/settings` already; the in-page redirect is a defensive double
 * check (matches dashboard/page.tsx).
 */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.error === 'RefreshAccessTokenError') {
    redirect('/login?error=RefreshAccessTokenError');
  }

  const t = await getTranslations('settings');
  const row = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { theme: true },
  });
  const currentTheme = isThemeId(row?.theme) ? row.theme : DEFAULT_THEME;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-foreground text-3xl font-semibold">{t('title')}</h1>
        <UserMenu user={{ displayName: session.user.displayName, email: session.user.email }} />
      </header>
      <section className="border-paper-line/80 flex flex-col gap-3 rounded-md border p-4">
        <h2 className="text-foreground text-sm font-semibold uppercase tracking-wide">
          {t('appearanceHeading')}
        </h2>
        <p className="text-muted-foreground text-xs">{t('appearanceDescription')}</p>
        <ThemeCardGrid currentTheme={currentTheme} />
      </section>
    </main>
  );
}
