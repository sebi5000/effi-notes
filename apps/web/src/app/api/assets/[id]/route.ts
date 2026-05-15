import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { patchCaptionSchema } from '@/lib/api/schemas.ts';

const log = createLogger({ component: 'api.assets.id' });

/** GET /api/assets/[id] — serve the raw asset bytes (auth-gated). */
export const GET = async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });
  if (!asset) return jsonError(404, 'asset not found');

  return new Response(Buffer.from(asset.data), {
    status: 200,
    headers: {
      'content-type': asset.contentType,
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
};

/** PATCH /api/assets/[id] — update the searchable caption (auth-gated). */
export const PATCH = async (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = patchCaptionSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const existing = await prisma.asset.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError(404, 'asset not found');

  return withSpan('assets.caption.patch', { 'asset.id': id }, async () => {
    await prisma.asset.update({ where: { id }, data: { caption: parsed.data.caption } });
    log.info({ assetId: id }, 'asset caption updated');
    return jsonOk({ id, caption: parsed.data.caption });
  });
};
