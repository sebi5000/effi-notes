import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';

const log = createLogger({ component: 'api.shares.seen' });

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Mark a share the current user is the grantee of as "seen". Idempotent —
 * sets `seenAt` only when still null. A non-grantee gets 404 (the share's
 * existence is not revealed).
 */
export const POST = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const share = await prisma.share.findUnique({
    where: { id },
    select: { id: true, granteeId: true, seenAt: true },
  });
  if (!share || share.granteeId !== user.id) return jsonError(404, 'not found');

  if (share.seenAt === null) {
    await prisma.share.update({ where: { id }, data: { seenAt: new Date() } });
    log.info({ shareId: id, userId: user.id }, 'share marked seen');
  }
  return jsonOk({ marked: true });
};
