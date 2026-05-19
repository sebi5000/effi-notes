import { prisma } from '@app/db';
import { resolvePublicNoteId } from '@/lib/notes/public-link.ts';
import { clientIp, rateLimit } from '@/lib/rate-limit.ts';

/**
 * Account-less asset stream for the public note viewer (ADR 0028).
 *
 * GET /p/[token]/assets/[assetId] — serves an asset's bytes only when the
 * token resolves to a live public link AND the asset belongs to that note.
 * Rate-limited by IP; every failure is an indistinguishable 404.
 */
type RouteContext = { params: Promise<{ token: string; assetId: string }> };

export const GET = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const limit = await rateLimit({
    key: clientIp(req),
    scope: 'public.asset',
    max: 240,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'retry-after': String(limit.resetSeconds) },
    });
  }

  const { token, assetId } = await ctx.params;
  const noteId = await resolvePublicNoteId(token);
  if (noteId === null) return new Response('Not Found', { status: 404 });

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { data: true, contentType: true, noteId: true },
  });
  // The asset must belong to the very note the token grants — never serve a
  // sibling note's asset just because the id was guessed.
  if (asset === null || asset.noteId !== noteId) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(Buffer.from(asset.data), {
    status: 200,
    headers: {
      'content-type': asset.contentType,
      'content-disposition': 'inline',
      // Short cache — a revoked link's images stop resolving within minutes.
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
};
