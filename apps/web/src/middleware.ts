import { auth } from '@/auth';
import { safeRedirect } from '@/lib/safe-redirect';

/**
 * Auth middleware. Runs on every matched path before the route handler.
 *
 * Public paths (no session required):
 *   /                    — landing
 *   /login               — sign-in page
 *   /api/auth/*          — auth.js callbacks
 *   /api/health/*        — orchestrator probes (must answer without auth)
 *   /p/*                 — account-less public note links (ADR 0028); the
 *                          route resolves the token and self-rate-limits
 *   /_next/*, static     — Next.js internals (excluded by matcher below)
 *
 * Anything else → redirect to /login with `from` set so we can return.
 *
 * Role-based authorisation does NOT happen here. Routes that need a
 * specific role check do so server-side via `requireRole()` from
 * @app/auth/rbac inside the page or route handler — keeps middleware
 * simple and the failure mode obvious.
 */
const PUBLIC_PATHS = new Set(['/', '/login']);
const PUBLIC_PREFIXES = ['/api/auth/', '/api/health/', '/p/'];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthed = !!req.auth;
  const isApi = pathname.startsWith('/api/');

  if (!isPublic && !isAuthed) {
    // API routes get a JSON 401 instead of an HTML redirect — REST clients
    // expect a parseable error envelope. Page routes redirect to /login with
    // a safe `from` so the user lands back where they started after sign-in.
    if (isApi) {
      return Response.json({ error: 'unauthorised' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', safeRedirect(pathname, '/dashboard'));
    return Response.redirect(loginUrl);
  }

  // Bounce authed users off /login — UNLESS an `?error=` is present. Pages
  // that detect a stale JWT (e.g. RefreshAccessTokenError) redirect *to*
  // /login?error=… on purpose so the user can re-auth; an unconditional
  // bounce here turns that into an infinite redirect loop.
  if (isAuthed && pathname === '/login' && !req.nextUrl.searchParams.has('error')) {
    return Response.redirect(new URL('/dashboard', req.url));
  }

  return undefined;
});

export const config = {
  // Node runtime is required: auth.js + the OIDC token-refresh flow pull
  // in `crypto`, `pg`, and other Node-only modules. Edge cannot run them.
  // Next 16 supports Node middleware natively.
  runtime: 'nodejs',
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)$).*)',
  ],
};
