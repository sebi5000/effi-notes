import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { createNoteSchema, listNotesQuerySchema, type NoteListItem } from '@/lib/api/schemas.ts';

const log = createLogger({ component: 'api.notes' });

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
});

export const GET = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const url = new URL(req.url);
  const parsed = listNotesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);

  const { folderId, tagId, q, includeArchived, limit, offset } = parsed.data;

  return withSpan(
    'notes.list',
    {
      ...(folderId === undefined ? {} : { 'notes.folder_id': folderId }),
      ...(tagId === undefined ? {} : { 'notes.tag_id': tagId }),
      'notes.has_q': !!q,
    },
    async () => {
      const notes = await prisma.note.findMany({
        where: {
          ...(folderId === undefined ? {} : { folderId }),
          ...(tagId === undefined ? {} : { tags: { some: { tagId } } }),
          ...(includeArchived === true ? {} : { archivedAt: null }),
          ...(q && q.trim().length > 0
            ? { OR: [{ title: { contains: q, mode: 'insensitive' } }] }
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
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      });
      return jsonOk({ notes: notes.map(toListItem) });
    },
  );
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
  const parsed = createNoteSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const { title, folderId, tagIds, body } = parsed.data;

  return withSpan('notes.create', { 'notes.title_len': title.length }, async () => {
    const created = await prisma.note.create({
      data: {
        title,
        body: body ?? '',
        authorId: user.id,
        ...(folderId === undefined || folderId === null ? {} : { folderId }),
        ...(tagIds && tagIds.length > 0
          ? { tags: { create: tagIds.map((id) => ({ tagId: id })) } }
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

    await recordAudit({
      action: 'notes.created',
      actorId: user.id,
      subject: created.id,
      metadata: { folderId: created.folderId, tagCount: created.tags.length },
    });
    log.info({ noteId: created.id, userId: user.id, folderId: created.folderId }, 'note created');

    return jsonCreated(toListItem(created));
  });
};
