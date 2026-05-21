import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { canEdit, resolveNoteAccess } from '@/lib/notes/access.ts';

/**
 * DELETE /api/notes/[id]/appointments/[linkId] — unlink an appointment from
 * a note (ADR 0031). Editor access required. Idempotent: 200 whether the
 * row existed or not.
 */

const log = createLogger({ component: 'api.notes.id.appointments.linkId' });
type RouteContext = { params: Promise<{ id: string; linkId: string }> };

export const DELETE = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id: noteId, linkId } = await ctx.params;

  const access = await resolveNoteAccess(user.id, noteId);
  if (access === null) return jsonError(404, 'not found');
  if (!canEdit(access)) return jsonError(403, 'forbidden');

  const deleted = await prisma.appointmentLink
    .delete({ where: { id: linkId, noteId } })
    .then(() => true)
    .catch(() => false);

  if (deleted) {
    await recordAudit({
      action: 'microsoft.appointment.unlinked',
      actorId: user.id,
      subject: linkId,
      metadata: { noteId },
    });
    log.info({ noteId, linkId, userId: user.id }, 'appointment unlinked');
  }
  return jsonOk({ unlinked: true });
};
