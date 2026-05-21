import { createLogger } from '@app/observability/logger';
import { z } from 'zod';
import { type AccessTokenResult, getMicrosoftAccessToken } from './tokens.ts';

/**
 * Thin Microsoft Graph wrapper (ADR 0031).
 *
 * Every Graph call goes through `graphFetch()`:
 *   1. Resolve a fresh access token for the calling user.
 *   2. Call Graph with `Authorization: Bearer …`.
 *   3. Validate the response shape with the supplied Zod schema.
 *
 * The token resolution failures (`not-connected` / `not-configured` /
 * `refresh-failed`) are propagated as a typed `GraphResult` so routes can
 * map them to HTTP statuses (412 → reconnect, 501 → "feature unavailable").
 */

const log = createLogger({ component: 'microsoft.graph' });
const BASE = 'https://graph.microsoft.com/v1.0';

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not-connected' | 'not-configured' | 'refresh-failed' | 'graph-error' };

const tokenFailure = (
  r: Extract<AccessTokenResult, { ok: false }>,
): Extract<GraphResult<never>, { ok: false }> => ({ ok: false, reason: r.reason });

/**
 * GET-only Graph helper. Builds the URL from `path` (e.g. `/me/events`) and
 * optional query params, validates the JSON body with `schema`.
 *
 * `fetcher` is injectable for tests.
 */
export async function graphGet<T>(opts: {
  userId: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  schema: z.ZodType<T>;
  fetcher?: typeof fetch;
}): Promise<GraphResult<T>> {
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const token = await getMicrosoftAccessToken(opts.userId, fetcher);
  if (!token.ok) return tokenFailure(token);

  const url = new URL(`${BASE}${opts.path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetcher(url.toString(), {
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      accept: 'application/json',
    },
  });
  if (!res.ok) {
    log.warn({ userId: opts.userId, path: opts.path, status: res.status }, 'graph error');
    return { ok: false, reason: 'graph-error' };
  }

  const parsed = opts.schema.safeParse(await res.json());
  if (!parsed.success) {
    log.error(
      { userId: opts.userId, path: opts.path, issues: parsed.error.issues },
      'malformed graph response',
    );
    return { ok: false, reason: 'graph-error' };
  }
  return { ok: true, data: parsed.data };
}

// --- Schemas the routes consume ---------------------------------------------

/**
 * Graph's `dateTimeTimeZone` envelope. We only need the absolute timestamp;
 * the timezone hint is ignored (clients render in the viewer's local tz).
 */
const dateTimeTimeZoneSchema = z
  .object({
    dateTime: z.string(),
    timeZone: z.string().optional(),
  })
  .nullable()
  .optional();

/** A search result from `/me/events?$search=…`. Trimmed to what we render. */
export const graphEventSchema = z.object({
  id: z.string(),
  subject: z.string().default(''),
  start: dateTimeTimeZoneSchema,
  end: dateTimeTimeZoneSchema,
  webLink: z.string().nullable().optional(),
});
export type GraphEvent = z.infer<typeof graphEventSchema>;

export const graphEventsResponseSchema = z.object({
  value: z.array(graphEventSchema),
});

/** Attendee row from `/me/events/{id}?$select=attendees`. */
export const graphAttendeeSchema = z.object({
  emailAddress: z
    .object({
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .nullable()
    .optional(),
  type: z.enum(['required', 'optional', 'resource']).optional(),
  status: z
    .object({
      response: z
        .enum(['none', 'organizer', 'tentativelyAccepted', 'accepted', 'declined', 'notResponded'])
        .optional(),
    })
    .nullable()
    .optional(),
});
export type GraphAttendee = z.infer<typeof graphAttendeeSchema>;

export const graphEventAttendeesResponseSchema = z.object({
  attendees: z.array(graphAttendeeSchema),
});
