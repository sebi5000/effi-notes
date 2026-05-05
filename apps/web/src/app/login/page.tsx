import { signIn } from '@/auth';

type SearchParams = {
  from?: string;
  error?: string;
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const callbackUrl = params.from ?? '/dashboard';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="text-sm text-muted-foreground">
        Authenticate via your organisation&apos;s identity provider.
      </p>

      {params.error ? (
        <p className="rounded border border-red-500 bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950">
          {params.error === 'RefreshAccessTokenError'
            ? 'Your session has expired. Please sign in again.'
            : 'Sign-in failed. Please try again.'}
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
          Continue with Keycloak
        </button>
      </form>
    </main>
  );
}
