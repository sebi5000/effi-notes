import { hasRole } from '@app/auth/rbac';
import { getDemoQueueCounts } from '@app/jobs';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { triggerDemoJob } from './actions.ts';

export default async function DashboardPage() {
  const session = await auth();

  // Middleware already guards this, but a defensive check makes the
  // page safe to render in isolation (Next dev tooling, e2e tests).
  if (!session?.user) redirect('/login');

  // If the access-token refresh failed, force a re-auth.
  if (session.error === 'RefreshAccessTokenError') {
    redirect('/login?error=RefreshAccessTokenError');
  }

  const isOps = hasRole(session.user, 'ops');
  const counts = isOps ? await getDemoQueueCounts() : null;

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

      <section className="rounded-md border border-current/10 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Demo queue
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Enqueues a no-op job on the <code>demo</code> queue. Worker logs the message and returns.
        </p>
        <form
          action={async () => {
            'use server';
            await triggerDemoJob();
          }}
          className="mt-3"
        >
          <button
            type="submit"
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            Trigger demo job
          </button>
        </form>

        {counts ? (
          <dl className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
            {(Object.entries(counts) as Array<[keyof typeof counts, number]>).map(([k, v]) => (
              <div key={k} className="rounded border border-current/10 p-2">
                <dt className="uppercase tracking-wide text-muted-foreground">{k}</dt>
                <dd className="mt-1 font-mono text-base">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {isOps ? (
          <Link
            href="/admin/queues"
            className="mt-4 inline-block text-xs underline hover:opacity-80"
          >
            Open Bull Board →
          </Link>
        ) : null}
      </section>

      <p className="text-xs text-muted-foreground">
        Phase 4 skeleton — auth + jobs plumbing. Customer projects add domain queues and processors.
      </p>
    </main>
  );
}
