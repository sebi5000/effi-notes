import Link from 'next/link';
import { auth } from '@/auth';

export default async function HomePage() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold">app-template</h1>
      <p className="text-sm text-muted-foreground">
        Phase 3 skeleton — auth wired, no jobs or telemetry yet.
      </p>
      <Link
        href={session?.user ? '/dashboard' : '/login'}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
      >
        {session?.user ? `Continue as ${session.user.email}` : 'Sign in'}
      </Link>
      <code className="rounded bg-muted px-3 py-1 text-xs">
        docs/superpowers/specs/2026-05-04-app-template-design.md
      </code>
    </main>
  );
}
