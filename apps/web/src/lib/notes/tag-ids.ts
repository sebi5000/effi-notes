import { prisma } from '@app/db';

/**
 * Resolve a request-supplied list of tag ids: drop duplicates, then check
 * that every remaining id exists. Returns either the de-duplicated list
 * (input order preserved) or the set of unknown ids so the caller can return
 * a clean 400 instead of letting a Prisma FK violation bubble up as a 500.
 *
 * Used by the create/patch note routes — without this an obviously-bad tag
 * id surfaces as an opaque server error (QA review 2026-05-20, P3).
 */
export type ResolveTagIdsResult = { ok: true; tagIds: string[] } | { ok: false; unknown: string[] };

export async function resolveTagIds(input: ReadonlyArray<string>): Promise<ResolveTagIdsResult> {
  // Preserve first-seen order so the client's intent (e.g. display order)
  // survives the round-trip.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const id of input) {
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }
  if (deduped.length === 0) return { ok: true, tagIds: [] };

  const found = await prisma.tag.findMany({
    where: { id: { in: deduped } },
    select: { id: true },
  });
  const foundIds = new Set(found.map((t) => t.id));
  const unknown = deduped.filter((id) => !foundIds.has(id));
  if (unknown.length > 0) return { ok: false, unknown };
  return { ok: true, tagIds: deduped };
}
