import { prisma } from '@app/db';
import { withSpan } from '@app/observability/tracing';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type SearchHit, searchQuerySchema } from '@/lib/api/schemas.ts';

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

      // Fast path: tsvector match with ts_headline snippet. Fallback to trigram
      // match on title if the tsquery comes back empty (very short / all
      // punctuation).
      const useTs = tsquery.length > 0;
      const rows: Row[] = useTs
        ? await prisma.$queryRawUnsafe<Row[]>(
            `SELECT n.id,
                  n.title,
                  n."folderId" as "folderId",
                  n."updatedAt",
                  ts_headline('simple', n.body, to_tsquery('simple', $1),
                              'StartSel=<mark>, StopSel=</mark>, MaxFragments=1, MaxWords=15, MinWords=5') AS snippet
             FROM "Note" n
            WHERE n."archivedAt" IS NULL
              AND n."searchVector" @@ to_tsquery('simple', $1)
            ORDER BY ts_rank(n."searchVector", to_tsquery('simple', $1)) DESC,
                     n."updatedAt" DESC
            LIMIT $2`,
            tsquery,
            limit,
          )
        : [];

      let final = rows;
      if (final.length === 0) {
        // Trigram fallback for typos / unusual punctuation.
        final = await prisma.$queryRawUnsafe<Row[]>(
          `SELECT n.id, n.title, n."folderId" as "folderId", n."updatedAt",
                left(n.body, 200) AS snippet
           FROM "Note" n
          WHERE n."archivedAt" IS NULL
            AND (n.title ILIKE '%' || $1 || '%' OR n.title % $1)
          ORDER BY similarity(n.title, $1) DESC, n."updatedAt" DESC
          LIMIT $2`,
          q,
          limit,
        );
      }

      const hits: SearchHit[] = final.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet ?? '',
        folderId: r.folderId,
        updatedAt: r.updatedAt.toISOString(),
      }));

      return jsonOk({ hits, total: hits.length });
    },
  );
};
