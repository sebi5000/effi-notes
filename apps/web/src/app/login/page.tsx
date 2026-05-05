import { getTranslations } from 'next-intl/server';
import { signIn } from '@/auth';
import { safeRedirect } from '@/lib/safe-redirect';

type SearchParams = {
  from?: string;
  error?: string;
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  // Validate the post-login destination at the entry point. auth.js does
  // its own redirect validation, but we want the value we hand it to be
  // already known-safe — defence in depth.
  const callbackUrl = safeRedirect(params.from, '/dashboard');
  const t = await getTranslations('login');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>

      {params.error ? (
        <p className="rounded border border-red-500 bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950">
          {params.error === 'RefreshAccessTokenError' ? t('errors.refresh') : t('errors.generic')}
        </p>
      ) : null}

      <form
        action={async () => {
          'use server';
          await signIn('keycloak', { redirectTo: callbackUrl });
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          {t('cta')}
        </button>
      </form>
    </main>
  );
}
