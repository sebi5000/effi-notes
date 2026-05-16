import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type ShareView, shareCreateSchema } from '@/lib/api/schemas.ts';
import { canManageShares, resolveNoteAccess } from '@/lib/notes/access.ts';
import { ttlToExpiresAt } from '@/lib/notes/share-ttl.ts';

const log = createLogger({ component: 'api.notes.shares' });
type RouteContext = { params: Promise<{ id: string }> };

const toShareView = (s: {
  id: string;
  access: 'VIEW' | 'EDIT';
  expiresAt: Date | null;
  createdById: string;
  createdAt: Date;
  grantee: { id: string; displayName: string | null; email: string };
}): ShareView => ({
  id: s.id,
  grantee: s.grantee,
  access: s.access,
  expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
  createdById: s.createdById,
  createdAt: s.createdAt.toISOString(),
});

const shareInclude = {
  grantee: { select: { id: true, displayName: true, email: true } },
} as const;

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const note = await prisma.note.findUnique({ where: { id }, select: { id: true } });
  if (!note) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (!canManageShares(access)) return jsonError(403, 'forbidden');

  const shares = await prisma.share.findMany({
    where: {
      noteId: id,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: shareInclude,
    orderBy: { createdAt: 'asc' },
  });
  return jsonOk({ shares: shares.map(toShareView) });
};

export const POST = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const note = await prisma.note.findUnique({ where: { id }, select: { id: true } });
  if (!note) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (!canManageShares(access)) return jsonError(403, 'forbidden');

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = shareCreateSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);
  const { granteeId, access: level, ttl } = parsed.data;
  if (granteeId === user.id) return jsonError(400, 'cannot share with yourself');

  const grantee = await prisma.user.findUnique({ where: { id: granteeId }, select: { id: true } });
  if (!grantee) return jsonError(400, 'unknown grantee');

  const expiresAt = ttlToExpiresAt(ttl);
  const share = await prisma.share.upsert({
    where: { noteId_granteeId: { noteId: id, granteeId } },
    create: { noteId: id, granteeId, access: level, expiresAt, createdById: user.id },
    update: { access: level, expiresAt, createdById: user.id },
    include: shareInclude,
  });
  await recordAudit({
    action: 'shares.granted',
    actorId: user.id,
    subject: share.id,
    metadata: { noteId: id, granteeId, access: level },
  });
  log.info({ shareId: share.id, noteId: id, granteeId }, 'note share granted');
  return jsonCreated(toShareView(share));
};
