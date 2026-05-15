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
      <h1 className="font-display text-foreground text-5xl font-semibold tracking-tight">
        effi · notes
      </h1>
      <p className="text-muted-foreground max-w-md text-center text-sm">{t('tagline')}</p>
      <Link
        href={email ? '/notes' : '/login'}
        className="bg-accent hover:bg-accent-ink rounded-md px-5 py-2 text-sm font-medium text-white shadow-sm transition"
      >
        {email ? t('continueAs', { email }) : t('signIn')}
      </Link>
    </main>
  );
}
