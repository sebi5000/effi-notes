import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import {
  createNoteSchema,
  listNotesQuerySchema,
  type NoteListItem,
  type SharedWithMe,
} from '@/lib/api/schemas.ts';
import {
  canEdit,
  type DirectShare,
  listAccessibleScope,
  resolveFolderAccess,
} from '@/lib/notes/access.ts';
import { toSnippet } from '@/lib/notes/snippet.ts';
import { resolveTagIds } from '@/lib/notes/tag-ids.ts';

const log = createLogger({ component: 'api.notes' });

const toSharedWithMe = (ds: DirectShare): SharedWithMe => ({
  shareId: ds.shareId,
  sharedByName: ds.sharedByName,
  access: ds.access,
  seenAt: ds.seenAt === null ? null : ds.seenAt.toISOString(),
});

const toListItem = (
  n: {
    id: string;
    title: string;
    body: string;
    folderId: string | null;
    authorId: string;
    archivedAt: Date | null;
    updatedAt: Date;
    tags: Array<{ tag: { id: string; name: string; color: string | null } }>;
    _count: { shares: number };
  },
  directShares?: Map<string, DirectShare>,
): NoteListItem => {
  const ds = directShares?.get(n.id);
  return {
    id: n.id,
    title: n.title,
    snippet: toSnippet(n.body),
    folderId: n.folderId,
    authorId: n.authorId,
    archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
    updatedAt: n.updatedAt.toISOString(),
    tags: n.tags.map((t) => t.tag),
    shareCount: n._count.shares,
    ...(ds === undefined ? {} : { sharedWithMe: toSharedWithMe(ds) }),
  };
};

export const GET = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const url = new URL(req.url);
  const parsed = listNotesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);

  const { folderId, tagId, q, includeArchived, section, limit, offset } = parsed.data;

  const scope = await listAccessibleScope(user.id);

  // `section=shared` narrows to notes the caller doesn't author but holds a
  // direct share for — answers the sidebar's "Shared with me" panel in one
  // round-trip instead of loading every note and filtering client-side.
  const accessFilter =
    section === 'shared'
      ? { AND: [{ id: { in: scope.sharedNoteIds } }, { authorId: { not: user.id } }] }
      : {
          OR: [
            { authorId: user.id },
            { folderId: { in: scope.accessibleFolderIds } },
            { id: { in: scope.sharedNoteIds } },
          ],
        };

  return withSpan(
    'notes.list',
    {
      ...(folderId === undefined ? {} : { 'notes.folder_id': folderId }),
      ...(tagId === undefined ? {} : { 'notes.tag_id': tagId }),
      'notes.section': section ?? 'all',
      'notes.has_q': !!q,
    },
    async () => {
      const notes = await prisma.note.findMany({
        where: {
          AND: [
            accessFilter,
            {
              ...(folderId === undefined ? {} : { folderId }),
              ...(tagId === undefined ? {} : { tags: { some: { tagId } } }),
              ...(includeArchived === true ? {} : { archivedAt: null }),
              ...(q && q.trim().length > 0
                ? { OR: [{ title: { contains: q, mode: 'insensitive' } }] }
                : {}),
            },
          ],
        },
        select: {
          id: true,
          title: true,
          body: true,
          folderId: true,
          authorId: true,
          archivedAt: true,
          updatedAt: true,
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
          _count: {
            select: {
              shares: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      });
      return jsonOk({ notes: notes.map((n) => toListItem(n, scope.directShares)) });
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

  if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
    const folderAccess = await resolveFolderAccess(user.id, parsed.data.folderId);
    if (!canEdit(folderAccess)) return jsonError(403, 'forbidden: target folder');
  }

  // Pre-validate tag ids so an obviously-bad id surfaces as a clean 400,
  // not a Prisma FK violation (QA review 2026-05-20, P3).
  const resolvedTags = await resolveTagIds(tagIds ?? []);
  if (!resolvedTags.ok) {
    return jsonError(400, 'unknown tag', { unknown: resolvedTags.unknown });
  }

  return withSpan('notes.create', { 'notes.title_len': title.length }, async () => {
    const created = await prisma.note.create({
      data: {
        title,
        body: body ?? '',
        authorId: user.id,
        ...(folderId === undefined || folderId === null ? {} : { folderId }),
        ...(resolvedTags.tagIds.length > 0
          ? { tags: { create: resolvedTags.tagIds.map((id) => ({ tagId: id })) } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        body: true,
        folderId: true,
        authorId: true,
        archivedAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        _count: {
          select: {
            shares: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
          },
        },
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
