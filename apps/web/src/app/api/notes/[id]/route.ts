import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type NoteDetail, patchNoteSchema } from '@/lib/api/schemas.ts';
import {
  canEdit,
  canHardDelete,
  resolveFolderAccess,
  resolveNoteAccess,
} from '@/lib/notes/access.ts';
import { toSnippet } from '@/lib/notes/snippet.ts';
import { resolveTagIds } from '@/lib/notes/tag-ids.ts';

const log = createLogger({ component: 'api.notes.id' });

type RouteContext = { params: Promise<{ id: string }> };

const noteSelect = {
  id: true,
  title: true,
  body: true,
  bodyVersion: true,
  folderId: true,
  authorId: true,
  lastEditorId: true,
  archivedAt: true,
  titleManuallySet: true,
  createdAt: true,
  updatedAt: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} as const;

const toDetail = (n: {
  id: string;
  title: string;
  body: string;
  bodyVersion: number;
  folderId: string | null;
  authorId: string;
  lastEditorId: string | null;
  archivedAt: Date | null;
  titleManuallySet: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags: Array<{ tag: { id: string; name: string; color: string | null } }>;
  _count?: { shares: number };
}): NoteDetail => ({
  id: n.id,
  title: n.title,
  snippet: toSnippet(n.body),
  body: n.body,
  bodyVersion: n.bodyVersion,
  folderId: n.folderId,
  authorId: n.authorId,
  lastEditorId: n.lastEditorId,
  archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
  titleManuallySet: n.titleManuallySet,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
  tags: n.tags.map((t) => t.tag),
  shareCount: n._count?.shares ?? 0,
});

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const note = await prisma.note.findUnique({ where: { id }, select: noteSelect });
  if (!note) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (access === null) return jsonError(403, 'forbidden');
  return jsonOk(toDetail(note));
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
  const parsed = patchNoteSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const existing = await prisma.note.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (!canEdit(access)) return jsonError(403, 'forbidden');
  if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
    const folderAccess = await resolveFolderAccess(user.id, parsed.data.folderId);
    if (!canEdit(folderAccess)) return jsonError(403, 'forbidden: target folder');
  }

  // Pre-validate any provided tag ids so a bad id is a clean 400 instead of
  // a Prisma FK error from the nested write below (QA review 2026-05-20, P3).
  let resolvedTagIds: string[] | undefined;
  if (parsed.data.tagIds !== undefined) {
    const r = await resolveTagIds(parsed.data.tagIds);
    if (!r.ok) return jsonError(400, 'unknown tag', { unknown: r.unknown });
    resolvedTagIds = r.tagIds;
  }

  return withSpan('notes.patch', { 'notes.id': id }, async () => {
    const { title, folderId, archivedAt, titleManuallySet } = parsed.data;
    const tagIds = resolvedTagIds;
    const updated = await prisma.note.update({
      where: { id },
      data: {
        ...(title === undefined ? {} : { title }),
        ...(folderId === undefined ? {} : { folderId }),
        ...(archivedAt === undefined
          ? {}
          : { archivedAt: archivedAt === null ? null : new Date(archivedAt) }),
        ...(titleManuallySet === undefined ? {} : { titleManuallySet }),
        lastEditorId: user.id,
        ...(tagIds === undefined
          ? {}
          : {
              tags: {
                deleteMany: {},
                create: tagIds.map((tagId) => ({ tagId })),
              },
            }),
      },
      select: noteSelect,
    });
    log.info({ noteId: id, userId: user.id }, 'note patched');
    return jsonOk(toDetail(updated));
  });
};

export const DELETE = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const hard = new URL(req.url).searchParams.get('hard') === '1';
  const existing = await prisma.note.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (hard ? !canHardDelete(access) : !canEdit(access)) return jsonError(403, 'forbidden');

  return withSpan('notes.delete', { 'notes.id': id, 'notes.hard': hard }, async () => {
    if (hard) {
      await prisma.note.delete({ where: { id } });
      await recordAudit({ action: 'notes.deleted', actorId: user.id, subject: id });
      log.warn({ noteId: id, userId: user.id }, 'note hard-deleted');
      return jsonOk({ deleted: true });
    }
    await prisma.note.update({
      where: { id },
      data: { archivedAt: new Date(), lastEditorId: user.id },
    });
    await recordAudit({ action: 'notes.archived', actorId: user.id, subject: id });
    log.info({ noteId: id, userId: user.id }, 'note archived');
    return jsonOk({ archived: true });
  });
};
