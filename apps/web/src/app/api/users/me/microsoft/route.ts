import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';

/**
 * DELETE /api/users/me/microsoft — disconnect the calling user's Microsoft
 * 365 integration (ADR 0031). Drops the MicrosoftAccount row; the next
 * Settings card render shows "Connect Microsoft 365" again. Existing
 * AppointmentLink rows in notes are left intact — the chip snapshots still
 * render, only the attendee popover degrades for this user.
 *
 * Idempotent: returns 200 whether the row existed or not, so the UI can fire
 * the request without checking first.
 */

const log = createLogger({ component: 'api.users.me.microsoft' });

export const DELETE = async (): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const deleted = await prisma.microsoftAccount
    .delete({ where: { userId: user.id } })
    .then(() => true)
    .catch(() => false);

  if (deleted) {
    await recordAudit({
      action: 'microsoft.account.unlinked',
      actorId: user.id,
      subject: user.id,
    });
    log.info({ userId: user.id }, 'microsoft account unlinked');
  }
  return jsonOk({ disconnected: true });
};
