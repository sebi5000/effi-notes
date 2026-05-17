import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, requireSession } from '@/lib/api/responses.ts';
import type { NoteListItem } from '@/lib/api/schemas.ts';
import { resolveNoteAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.notes.duplicate' });

type RouteContext = { params: Promise<{ id: string }> };

const toListItem = (n: {
  id: string;
  title: string;
  folderId: string | null;
  authorId: string;
  archivedAt: Date | null;
  updatedAt: Date;
  tags: Array<{ tag: { id: string; name: string; color: string | null } }>;
}): NoteListItem => ({
  id: n.id,
  title: n.title,
  folderId: n.folderId,
  authorId: n.authorId,
  archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
  updatedAt: n.updatedAt.toISOString(),
  tags: n.tags.map((t) => t.tag),
  shareCount: 0,
});

/** POST /api/notes/[id]/duplicate — deep-copies a note (body, tags, assets). */
export const POST = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const source = await prisma.note.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      body: true,
      folderId: true,
      tags: { select: { tagId: true } },
      assets: {
        select: {
          id: true,
          kind: true,
          contentType: true,
          filename: true,
          caption: true,
          extractedText: true,
          byteSize: true,
          data: true,
          previewImage: true,
          previewContentType: true,
          pageCount: true,
        },
      },
    },
  });
  if (!source) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (access === null) return jsonError(403, 'forbidden');

  return withSpan('notes.duplicate', { 'notes.id': id }, async () => {
    const created = await prisma.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: {
          title: `${source.title} (Kopie)`,
          titleManuallySet: true,
          body: source.body,
          authorId: user.id,
          ...(source.folderId ? { folderId: source.folderId } : {}),
          ...(source.tags.length > 0
            ? { tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) } }
            : {}),
        },
        select: {
          id: true,
          title: true,
          folderId: true,
          authorId: true,
          archivedAt: true,
          updatedAt: true,
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        },
      });

      let body = source.body;
      for (const a of source.assets) {
        const copy = await tx.asset.create({
          data: {
            noteId: note.id,
            authorId: user.id,
            kind: a.kind,
            contentType: a.contentType,
            filename: a.filename,
            caption: a.caption,
            extractedText: a.extractedText,
            byteSize: a.byteSize,
            data: a.data,
            previewImage: a.previewImage,
            previewContentType: a.previewContentType,
            pageCount: a.pageCount,
          },
          select: { id: true },
        });
        // Asset ids are unique cuids — a plain split/join rewrites every
        // reference (image URL + pdf-chip attribute) with no false matches.
        body = body.split(a.id).join(copy.id);
      }
      if (source.assets.length > 0) {
        await tx.note.update({ where: { id: note.id }, data: { body } });
      }
      return note;
    });

    await recordAudit({
      action: 'notes.duplicated',
      actorId: user.id,
      subject: created.id,
      metadata: { sourceId: id },
    });
    log.info({ noteId: created.id, sourceId: id, userId: user.id }, 'note duplicated');
    return jsonCreated(toListItem(created));
  });
};
