import type { AppUser } from '@app/auth/types';
import { auth } from '@/auth';
import type { ApiError } from './schemas.ts';

/**
 * Helpers to keep route handlers small and consistent.
 *
 * - `requireSession()` returns the session user or null. Routes that need a
 *   user call this and `return jsonError(401, ...)` on null. Centralising
 *   the call site (rather than every route inlining `await auth()`) makes
 *   it cheap to swap in a different auth strategy later.
 *
 * - `jsonError` / `jsonOk` standardise the response shape. The error envelope
 *   is `{ error: string }`, matching the existing /admin/queues handler's
 *   string-body responses while being parseable by `fetch().then(r => r.json())`.
 */

export const jsonOk = <T>(body: T, init: ResponseInit = {}): Response =>
  Response.json(body, { status: 200, ...init });

export const jsonCreated = <T>(body: T): Response => Response.json(body, { status: 201 });

export const jsonError = (status: number, message: string, details?: unknown): Response => {
  const payload: ApiError =
    details === undefined ? { error: message } : { error: message, details };
  return Response.json(payload, { status });
};

export const requireSession = async (): Promise<AppUser | null> => {
  const session = await auth();
  return session?.user ?? null;
};
