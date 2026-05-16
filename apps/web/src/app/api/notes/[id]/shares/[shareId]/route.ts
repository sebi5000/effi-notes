import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { resolveNoteAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.notes.shares.id' });
type RouteContext = { params: Promise<{ id: string; shareId: string }> };

export const DELETE = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id, shareId } = await ctx.params;

  const share = await prisma.share.findUnique({
    where: { id: shareId },
    select: { id: true, noteId: true, createdById: true },
  });
  if (!share || share.noteId !== id) return jsonError(404, 'not found');

  const access = await resolveNoteAccess(user.id, id);
  // Owner may revoke any share; an EDIT-grantee only shares they created.
  const allowed = access === 'OWNER' || (access === 'EDIT' && share.createdById === user.id);
  if (!allowed) return jsonError(403, 'forbidden');

  await prisma.share.delete({ where: { id: shareId } });
  await recordAudit({
    action: 'shares.revoked',
    actorId: user.id,
    subject: shareId,
    metadata: { noteId: id },
  });
  log.info({ shareId, noteId: id, userId: user.id }, 'note share revoked');
  return jsonOk({ revoked: true });
};
