import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { graphEventAttendeesResponseSchema, graphGet } from '@/lib/microsoft/graph.ts';

/**
 * GET /api/users/me/microsoft/appointments/[id]/attendees — live attendee
 * fetch for the chip / sidebar popover (ADR 0031).
 *
 * Status mapping:
 *   200 — { attendees: Array<{ name?, email?, response? }> }
 *   401 — no session
 *   412 — caller has no MicrosoftAccount (UI shows "Connect M365")
 *   501 — feature not configured (env vars missing)
 *   502 — Graph itself returned an error (transient or stale event id)
 *
 * The viewer's own M365 token is used — explicitly NOT the original
 * linker's. A collaborator without a connection sees the chip in the
 * doc (subject is in our DB) but the popover routes through here and
 * comes back 412.
 */

type RouteContext = { params: Promise<{ id: string }> };

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const result = await graphGet({
    userId: user.id,
    // `$select=attendees` keeps the payload tiny — we don't need the rest
    // of the event for this view.
    path: `/me/events/${encodeURIComponent(id)}`,
    query: { $select: 'attendees' },
    schema: graphEventAttendeesResponseSchema,
  });

  if (!result.ok) {
    if (result.reason === 'not-configured')
      return jsonError(501, 'microsoft 365 is not configured');
    if (result.reason === 'not-connected') return jsonError(412, 'microsoft not connected');
    if (result.reason === 'refresh-failed') return jsonError(412, 'microsoft connection expired');
    return jsonError(502, 'graph error');
  }

  // Trim to the small shape the UI renders — name + email + response. The
  // route never echoes the raw Graph payload.
  const attendees = result.data.attendees.map((a) => ({
    ...(a.emailAddress?.name ? { name: a.emailAddress.name } : {}),
    ...(a.emailAddress?.address ? { email: a.emailAddress.address } : {}),
    ...(a.status?.response ? { response: a.status.response } : {}),
  }));
  return jsonOk({ attendees });
};
