import { authConfig } from '@app/auth/config';
import NextAuth from 'next-auth';

// Single auth.js instance for the whole app. Exports:
// - `auth()`         — server-side session accessor (RSC, route handlers, middleware)
// - `signIn()`       — server action for triggering Keycloak login
// - `signOut()`      — server action for logout
// - `handlers`       — GET/POST for /api/auth/[...nextauth]/route.ts
export const { auth, signIn, signOut, handlers } = NextAuth(authConfig);
