import { Prisma, prisma } from '@app/db';
import { withSpan } from '@app/observability/tracing';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type SearchHit, searchQuerySchema } from '@/lib/api/schemas.ts';
import { listAccessibleScope } from '@/lib/notes/access.ts';

/**
 * GET /api/search?q=… — full-text search across notes.
 *
 * - Uses the `searchVector` generated column (title weighted A, body B)
 *   for ranked matches.
 * - Falls through to a trigram fuzzy match on title so typos still hit.
 * - Hides archived notes from search; archive view is opt-in via /api/notes.
 */

type Row = {
  id: string;
  title: string;
  folderId: string | null;
  updatedAt: Date;
  snippet: string;
};

/**
 * Same shape as `Row` plus the appointment subject that drove the match,
 * so the merge step below can attach it to `SearchHit.matchedVia` and the
 * CommandBar can render "matched via 'Q4 Review'" under the title
 * (ADR 0031).
 */
type AppointmentRow = Row & { matchedSubject: string };

const buildTsquery = (raw: string): string => {
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length > 0)
    .map((t) => `${t}:*`);
  return tokens.join(' & ');
};

export const GET = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const parsed = searchQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);

  const { q, limit } = parsed.data;

  return withSpan(
    'notes.search',
    { 'notes.search.q_len': q.length, 'notes.search.limit': limit },
    async () => {
      const tsquery = buildTsquery(q);

      const scope = await listAccessibleScope(user.id);

      // Fast path: tsvector match with ts_headline snippet. Fallback to trigram
      // match on title if the tsquery comes back empty (very short / all
      // punctuation).
      const useTs = tsquery.length > 0;
      // Direct note hits and asset-driven hits are independent queries —
      // run them concurrently to keep the search hot path fast.
      //
      // Tagged templates (Prisma.sql) replaced the earlier $queryRawUnsafe so
      // values can never accidentally drift into the SQL string — the SQL
      // shape is the static, named-parameter form; callers can only inject
      // values via `${…}` interpolation (QA review 2026-05-20, P3).
      const [noteRows, assetRows]: [Row[], Row[]] = useTs
        ? await Promise.all([
            prisma.$queryRaw<Row[]>(Prisma.sql`
              SELECT n.id,
                  n.title,
                  n."folderId" as "folderId",
                  n."updatedAt",
                  ts_headline('simple', n.body, to_tsquery('simple', ${tsquery}),
                              'StartSel=<mark>, StopSel=</mark>, MaxFragments=1, MaxWords=15, MinWords=5') AS snippet
             FROM "Note" n
            WHERE n."archivedAt" IS NULL
              AND n."searchVector" @@ to_tsquery('simple', ${tsquery})
              AND (n."authorId" = ${user.id}
                   OR n."folderId" = ANY(${scope.accessibleFolderIds}::text[])
                   OR n.id = ANY(${scope.sharedNoteIds}::text[]))
            ORDER BY ts_rank(n."searchVector", to_tsquery('simple', ${tsquery})) DESC,
                     n."updatedAt" DESC
            LIMIT ${limit}
            `),
            // A note also matches when one of its embedded assets matches by
            // filename / caption / extracted text. Surfaced as the owning note.
            prisma.$queryRaw<Row[]>(Prisma.sql`
              SELECT DISTINCT n.id,
                  n.title,
                  n."folderId" as "folderId",
                  n."updatedAt",
                  left(n.body, 200) AS snippet
             FROM "Asset" a
             JOIN "Note" n ON n.id = a."noteId"
            WHERE n."archivedAt" IS NULL
              AND a."searchVector" @@ to_tsquery('simple', ${tsquery})
              AND (n."authorId" = ${user.id}
                   OR n."folderId" = ANY(${scope.accessibleFolderIds}::text[])
                   OR n.id = ANY(${scope.sharedNoteIds}::text[]))
            ORDER BY n."updatedAt" DESC
            LIMIT ${limit}
            `),
          ])
        : [[], []];

      // Third source: notes whose linked Microsoft Graph appointments'
      // subjects match the query. Joined here rather than at the call sites
      // (CommandBar, etc.) so every search surface gets it consistently.
      // ILIKE is acceptable for v1 — the `@@index([subject])` from ADR 0031
      // covers the equality side; a tsvector column is the documented
      // follow-up if latency drifts.
      const appointmentRows = await prisma.$queryRaw<AppointmentRow[]>(Prisma.sql`
        SELECT DISTINCT ON (n.id) n.id,
            n.title,
            n."folderId" as "folderId",
            n."updatedAt",
            left(n.body, 200) AS snippet,
            al.subject AS "matchedSubject"
         FROM "AppointmentLink" al
         JOIN "Note" n ON n.id = al."noteId"
        WHERE n."archivedAt" IS NULL
          AND al.subject ILIKE '%' || ${q} || '%'
          AND (n."authorId" = ${user.id}
               OR n."folderId" = ANY(${scope.accessibleFolderIds}::text[])
               OR n.id = ANY(${scope.sharedNoteIds}::text[]))
        ORDER BY n.id, n."updatedAt" DESC
        LIMIT ${limit}
      `);

      // Merge: direct note hits first, then asset-only hits, then
      // appointment-only hits, de-duplicated. Appointment hits carry an
      // extra `matchedSubject` we attach to the final SearchHit shape.
      const seen = new Set(noteRows.map((r) => r.id));
      const rows: Row[] = [...noteRows, ...assetRows.filter((r) => !seen.has(r.id))].slice(
        0,
        limit,
      );
      for (const r of rows) seen.add(r.id);
      const appointmentExtra = appointmentRows.filter((r) => !seen.has(r.id));

      let final: Row[] = rows;
      if (final.length === 0 && appointmentExtra.length === 0) {
        // Trigram fallback for typos / unusual punctuation.
        final = await prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT n.id, n.title, n."folderId" as "folderId", n."updatedAt",
                left(n.body, 200) AS snippet
           FROM "Note" n
          WHERE n."archivedAt" IS NULL
            AND (n.title ILIKE '%' || ${q} || '%' OR n.title % ${q})
            AND (n."authorId" = ${user.id}
                 OR n."folderId" = ANY(${scope.accessibleFolderIds}::text[])
                 OR n.id = ANY(${scope.sharedNoteIds}::text[]))
          ORDER BY similarity(n.title, ${q}) DESC, n."updatedAt" DESC
          LIMIT ${limit}
        `);
      }

      const appointmentSubjectById = new Map(
        appointmentRows.map((r) => [r.id, r.matchedSubject] as const),
      );
      // Combine the trimmed `final` (note / asset hits) with the
      // appointment-only extras; cap to `limit`.
      const merged: Array<Row & { matchedSubject?: string }> = [
        ...final,
        ...appointmentExtra,
      ].slice(0, limit);
      const hits: SearchHit[] = merged.map((r) => {
        const subject = r.matchedSubject ?? appointmentSubjectById.get(r.id);
        return {
          id: r.id,
          title: r.title,
          snippet: r.snippet ?? '',
          folderId: r.folderId,
          updatedAt: r.updatedAt.toISOString(),
          ...(subject ? { matchedVia: { kind: 'appointment' as const, subject } } : {}),
        };
      });

      return jsonOk({ hits, total: hits.length });
    },
  );
};
