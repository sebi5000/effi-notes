import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';

export default async function DashboardPage() {
  const session = await auth();

  // Middleware already guards this, but a defensive check makes the
  // page safe to render in isolation (Next dev tooling, e2e tests).
  if (!session?.user) redirect('/login');

  // If the access-token refresh failed, force a re-auth.
  if (session.error === 'RefreshAccessTokenError') {
    redirect('/login?error=RefreshAccessTokenError');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="rounded border border-current px-3 py-1 text-sm hover:bg-muted"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded-md border border-current/10 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Signed-in user
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Display name</dt>
          <dd>{session.user.displayName ?? '—'}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{session.user.email}</dd>
          <dt className="text-muted-foreground">Locale</dt>
          <dd>{session.user.locale}</dd>
          <dt className="text-muted-foreground">Roles</dt>
          <dd>{session.user.roles.length > 0 ? session.user.roles.join(', ') : '—'}</dd>
          <dt className="text-muted-foreground">Internal id</dt>
          <dd className="font-mono text-xs">{session.user.id}</dd>
        </dl>
      </section>

      <p className="text-xs text-muted-foreground">
        Phase 3 skeleton — auth + RBAC plumbing only. Customer projects extend roles, dashboards,
        and route guards from here.
      </p>
    </main>
  );
}
