import { z } from 'zod';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { graphEventsResponseSchema, graphGet } from '@/lib/microsoft/graph.ts';

/**
 * GET /api/users/me/microsoft/appointments?q=<subject> — search the caller's
 * Outlook calendar (ADR 0031). Used by the editor's `$$` overlay; returns a
 * compact list of events the user can pick from.
 *
 * Status mapping mirrors `/attendees`: 412 → reconnect, 501 → not configured,
 * 502 → Graph error.
 */

const querySchema = z.object({
  q: z.string().min(1).max(120),
  // 20 is Graph's default $top and a comfortable list size for the overlay.
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const isoOrNull = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const GET = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);

  const result = await graphGet({
    userId: user.id,
    path: '/me/events',
    // Graph's `$search` does a fuzzy match across subject + body. We add
    // `subject:` to scope tightly — picking by subject is the user's mental
    // model. `$select` keeps the response small.
    query: {
      $search: `"subject:${parsed.data.q}"`,
      $select: 'id,subject,start,end,webLink',
      $top: parsed.data.limit,
    },
    schema: graphEventsResponseSchema,
  });

  if (!result.ok) {
    if (result.reason === 'not-configured')
      return jsonError(501, 'microsoft 365 is not configured');
    if (result.reason === 'not-connected') return jsonError(412, 'microsoft not connected');
    if (result.reason === 'refresh-failed') return jsonError(412, 'microsoft connection expired');
    return jsonError(502, 'graph error');
  }

  const events = result.data.value.map((e) => ({
    id: e.id,
    subject: e.subject,
    startsAt: isoOrNull(e.start?.dateTime),
    endsAt: isoOrNull(e.end?.dateTime),
    webLink: e.webLink ?? null,
  }));
  return jsonOk({ events });
};
