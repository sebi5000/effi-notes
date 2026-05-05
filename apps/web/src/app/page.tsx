import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { auth } from '@/auth';

export default async function HomePage() {
  const session = await auth();
  return <Inner email={session?.user?.email ?? null} />;
}

function Inner({ email }: { email: string | null }) {
  const t = useTranslations('home');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold">app-template</h1>
      <p className="text-sm text-muted-foreground">{t('tagline')}</p>
      <Link
        href={email ? '/dashboard' : '/login'}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
      >
        {email ? t('continueAs', { email }) : t('signIn')}
      </Link>
      <code className="rounded bg-muted px-3 py-1 text-xs">
        docs/superpowers/specs/2026-05-04-app-template-design.md
      </code>
    </main>
  );
}
