import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { resolveFolderAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.folders.shares.id' });
type RouteContext = { params: Promise<{ id: string; shareId: string }> };

export const DELETE = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id, shareId } = await ctx.params;

  const share = await prisma.share.findUnique({
    where: { id: shareId },
    select: { id: true, folderId: true, createdById: true },
  });
  if (!share || share.folderId !== id) return jsonError(404, 'not found');

  const access = await resolveFolderAccess(user.id, id);
  // Owner may revoke any share; an EDIT-grantee only shares they created.
  const allowed = access === 'OWNER' || (access === 'EDIT' && share.createdById === user.id);
  if (!allowed) return jsonError(403, 'forbidden');

  await prisma.share.delete({ where: { id: shareId } });
  await recordAudit({
    action: 'shares.revoked',
    actorId: user.id,
    subject: shareId,
    metadata: { folderId: id },
  });
  log.info({ shareId, folderId: id, userId: user.id }, 'folder share revoked');
  return jsonOk({ revoked: true });
};
