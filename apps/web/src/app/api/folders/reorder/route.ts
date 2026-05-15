import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { reorderFoldersSchema } from '@/lib/api/schemas.ts';
import { isDescendant } from '@/lib/notes/folder-tree.ts';

const log = createLogger({ component: 'api.folders.reorder' });

/**
 * PATCH /api/folders/reorder — bulk reparent + reposition.
 *
 * Body: { parentId: string | null, orderedIds: string[] }
 *
 * Every id in `orderedIds` is moved under `parentId` and given a contiguous
 * `position` (its array index) in a single transaction. This is the one
 * write path drag-and-drop uses — same-level reordering and cross-hierarchy
 * moves are the same operation (the dragged folder simply also changes
 * parent).
 *
 * `reorder` is a static path segment, so it never collides with the
 * `/api/folders/[id]` dynamic route.
 */
export const PATCH = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = reorderFoldersSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const { parentId, orderedIds } = parsed.data;
  const uniqueIds = new Set(orderedIds);
  if (uniqueIds.size !== orderedIds.length) {
    return jsonError(400, 'orderedIds contains duplicates');
  }

  return withSpan(
    'folders.reorder',
    { 'folders.parent_id': parentId ?? 'root', 'folders.count': orderedIds.length },
    async () => {
      // Load the whole tree once: needed both to verify every id exists and
      // to run the cycle guard.
      const all = await prisma.folder.findMany({ select: { id: true, parentId: true } });
      const known = new Set(all.map((f) => f.id));

      for (const id of orderedIds) {
        if (!known.has(id)) return jsonError(400, 'unknown folder', { id });
      }
      if (parentId !== null && !known.has(parentId)) {
        return jsonError(400, 'unknown parent folder', { parentId });
      }

      // Cycle guard: the new parent must not be the moved folder itself nor
      // any of its descendants. `folder-tree` rows expose `parentId` only —
      // pad them to FolderNode-ish for isDescendant (it reads `parentId`).
      if (parentId !== null) {
        const treeish = all.map((f) => ({
          id: f.id,
          parentId: f.parentId,
          name: '',
          position: 0,
          createdAt: '',
          updatedAt: '',
        }));
        for (const id of orderedIds) {
          if (id === parentId || isDescendant(treeish, id, parentId)) {
            return jsonError(409, 'cannot move a folder into its own subtree', { id });
          }
        }
      }

      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.folder.update({
            where: { id },
            data: { parentId, position: index },
          }),
        ),
      );

      log.info({ userId: user.id, parentId, count: orderedIds.length }, 'folders reordered');
      return jsonOk({ reordered: orderedIds.length });
    },
  );
};
