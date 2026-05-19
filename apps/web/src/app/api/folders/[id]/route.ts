import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type FolderNode, patchFolderSchema } from '@/lib/api/schemas.ts';
import { canEdit, canHardDelete, resolveFolderAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.folders.id' });
type RouteContext = { params: Promise<{ id: string }> };

// Evaluated per request so the "now" boundary is never frozen at module load.
const activeShareWhere = () => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
});

const toNode = (f: {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  icon: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { shares: number };
}): FolderNode => ({
  id: f.id,
  name: f.name,
  parentId: f.parentId,
  position: f.position,
  icon: f.icon,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
  shareCount: f._count.shares,
});

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const folder = await prisma.folder.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      parentId: true,
      position: true,
      icon: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { shares: { where: activeShareWhere() } } },
    },
  });
  if (!folder) return jsonError(404, 'not found');

  const access = await resolveFolderAccess(user.id, id);
  if (access === null) return jsonError(403, 'forbidden');

  return jsonOk(toNode(folder));
};

export const PATCH = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = patchFolderSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const existing = await prisma.folder.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError(404, 'not found');

  const access = await resolveFolderAccess(user.id, id);
  if (!canEdit(access)) return jsonError(403, 'forbidden');

  if (parsed.data.parentId === id) {
    return jsonError(400, 'folder cannot be its own parent');
  }

  if (parsed.data.parentId !== undefined && parsed.data.parentId !== null) {
    const parentAccess = await resolveFolderAccess(user.id, parsed.data.parentId);
    if (!canEdit(parentAccess)) return jsonError(403, 'forbidden: parent folder');
  }

  const updated = await prisma.folder.update({
    where: { id },
    data: {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.parentId === undefined ? {} : { parentId: parsed.data.parentId }),
      ...(parsed.data.position === undefined ? {} : { position: parsed.data.position }),
      ...(parsed.data.icon === undefined ? {} : { icon: parsed.data.icon }),
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      position: true,
      icon: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { shares: { where: activeShareWhere() } } },
    },
  });
  log.info({ folderId: id, userId: user.id }, 'folder patched');
  return jsonOk(toNode(updated));
};

export const DELETE = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const existing = await prisma.folder.findUnique({
    where: { id },
    select: { id: true, _count: { select: { notes: true, children: true } } },
  });
  if (!existing) return jsonError(404, 'not found');

  const access = await resolveFolderAccess(user.id, id);
  if (!canHardDelete(access)) return jsonError(403, 'forbidden');

  if (existing._count.notes > 0 || existing._count.children > 0) {
    return jsonError(409, 'folder not empty', existing._count);
  }

  await prisma.folder.delete({ where: { id } });
  await recordAudit({ action: 'folders.deleted', actorId: user.id, subject: id });
  log.warn({ folderId: id, userId: user.id }, 'folder deleted');
  return jsonOk({ deleted: true });
};
