import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { createFolderSchema, type FolderNode } from '@/lib/api/schemas.ts';
import { canEdit, listAccessibleScope, resolveFolderAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.folders' });

const activeShareWhere = {
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
};

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

export const GET = async (): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const scope = await listAccessibleScope(user.id);

  const folders = await prisma.folder.findMany({
    where: { id: { in: scope.accessibleFolderIds } },
    select: {
      id: true,
      name: true,
      parentId: true,
      position: true,
      icon: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { shares: { where: activeShareWhere } } },
    },
    orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { name: 'asc' }],
  });
  return jsonOk({ folders: folders.map(toNode) });
};

export const POST = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = createFolderSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const { name, parentId, position } = parsed.data;

  if (parentId) {
    const parentAccess = await resolveFolderAccess(user.id, parentId);
    if (!canEdit(parentAccess)) return jsonError(403, 'forbidden: parent folder');
  }

  const created = await prisma.folder.create({
    data: {
      name,
      ownerId: user.id,
      ...(parentId === undefined || parentId === null ? {} : { parentId }),
      ...(position === undefined ? {} : { position }),
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      position: true,
      icon: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { shares: { where: activeShareWhere } } },
    },
  });
  await recordAudit({
    action: 'folders.created',
    actorId: user.id,
    subject: created.id,
    metadata: { parentId: created.parentId },
  });
  log.info({ folderId: created.id, userId: user.id }, 'folder created');
  return jsonCreated(toNode(created));
};
