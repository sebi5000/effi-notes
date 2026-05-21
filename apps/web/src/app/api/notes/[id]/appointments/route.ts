import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { z } from 'zod';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { graphEventSchema, graphGet } from '@/lib/microsoft/graph.ts';
import { canEdit, resolveNoteAccess } from '@/lib/notes/access.ts';

/**
 * /api/notes/[id]/appointments (ADR 0031)
 *
 *   GET  — list the AppointmentLink rows for the note (snapshot only;
 *          attendees are NEVER returned here — they're fetched live per-open
 *          by `/api/users/me/microsoft/appointments/[id]/attendees`).
 *          Any viewer with note access can read.
 *
 *   POST — link a Graph event to this note. Body: `{ eventId }`. Server uses
 *          the LINKER's M365 token to re-fetch the event metadata and
 *          snapshot subject/start/end/webLink into the row. Editor access on
 *          the note required. Idempotent via `@@unique([noteId, eventId])`.
 */

const log = createLogger({ component: 'api.notes.id.appointments' });
type RouteContext = { params: Promise<{ id: string }> };

const linkBodySchema = z.object({ eventId: z.string().min(1).max(512) });

type LinkView = {
  id: string;
  noteId: string;
  eventId: string;
  subject: string;
  startsAt: string | null;
  endsAt: string | null;
  webLink: string | null;
  linkedById: string;
  linkedAt: string;
};

const toView = (row: {
  id: string;
  noteId: string;
  eventId: string;
  subject: string;
  startsAt: Date | null;
  endsAt: Date | null;
  webLink: string | null;
  linkedById: string;
  linkedAt: Date;
}): LinkView => ({
  id: row.id,
  noteId: row.noteId,
  eventId: row.eventId,
  subject: row.subject,
  startsAt: row.startsAt?.toISOString() ?? null,
  endsAt: row.endsAt?.toISOString() ?? null,
  webLink: row.webLink,
  linkedById: row.linkedById,
  linkedAt: row.linkedAt.toISOString(),
});

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id: noteId } = await ctx.params;

  const access = await resolveNoteAccess(user.id, noteId);
  if (access === null) return jsonError(404, 'not found');

  const rows = await prisma.appointmentLink.findMany({
    where: { noteId },
    orderBy: { startsAt: 'asc' },
  });
  return jsonOk({ appointments: rows.map(toView) });
};

export const POST = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id: noteId } = await ctx.params;

  const access = await resolveNoteAccess(user.id, noteId);
  if (access === null) return jsonError(404, 'not found');
  if (!canEdit(access)) return jsonError(403, 'forbidden');

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = linkBodySchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  // Snapshot the Graph event so the chip text + search index don't depend on
  // a future Graph round-trip. Live attendees are intentionally NOT cached.
  const graph = await graphGet({
    userId: user.id,
    path: `/me/events/${encodeURIComponent(parsed.data.eventId)}`,
    query: { $select: 'id,subject,start,end,webLink' },
    schema: graphEventSchema,
  });
  if (!graph.ok) {
    if (graph.reason === 'not-configured') return jsonError(501, 'microsoft 365 is not configured');
    if (graph.reason === 'not-connected') return jsonError(412, 'microsoft not connected');
    if (graph.reason === 'refresh-failed') return jsonError(412, 'microsoft connection expired');
    return jsonError(502, 'graph error');
  }

  const startsAt = graph.data.start?.dateTime ? new Date(graph.data.start.dateTime) : null;
  const endsAt = graph.data.end?.dateTime ? new Date(graph.data.end.dateTime) : null;

  // Upsert keyed on (noteId, eventId): the same event linked twice from the
  // same note is a no-op-with-refreshed-snapshot, not an error.
  const row = await prisma.appointmentLink.upsert({
    where: { noteId_eventId: { noteId, eventId: graph.data.id } },
    create: {
      noteId,
      eventId: graph.data.id,
      subject: graph.data.subject,
      startsAt,
      endsAt,
      webLink: graph.data.webLink ?? null,
      linkedById: user.id,
    },
    update: {
      subject: graph.data.subject,
      startsAt,
      endsAt,
      webLink: graph.data.webLink ?? null,
      linkedById: user.id,
    },
  });
  await recordAudit({
    action: 'microsoft.appointment.linked',
    actorId: user.id,
    subject: row.id,
    metadata: { noteId, eventId: graph.data.id },
  });
  log.info({ noteId, eventId: graph.data.id, userId: user.id }, 'appointment linked');
  return jsonCreated(toView(row));
};
