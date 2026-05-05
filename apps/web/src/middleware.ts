import { auth } from '@/auth';

/**
 * Auth middleware. Runs on every matched path before the route handler.
 *
 * Public paths (no session required):
 *   /                    — landing
 *   /login               — sign-in page
 *   /api/auth/*          — auth.js callbacks
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

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/auth');
  const isAuthed = !!req.auth;

  if (!isPublic && !isAuthed) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return Response.redirect(loginUrl);
  }

  if (isAuthed && pathname === '/login') {
    return Response.redirect(new URL('/dashboard', req.url));
  }

  return undefined;
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)$).*)',
  ],
};
