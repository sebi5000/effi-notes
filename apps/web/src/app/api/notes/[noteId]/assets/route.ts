import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, requireSession } from '@/lib/api/responses.ts';
import { assetUploadQuerySchema } from '@/lib/api/schemas.ts';
import { MAX_ASSET_BYTES, sniffImageType } from '@/lib/notes/asset-mime.ts';

const log = createLogger({ component: 'api.assets.upload' });

/**
 * POST /api/notes/[noteId]/assets — upload an image into a note.
 * The raw file bytes are the request body; the filename is `?filename=`.
 * The stored MIME type comes from the file's magic bytes, never the
 * client-supplied Content-Type.
 */
export const POST = async (
  req: Request,
  ctx: { params: Promise<{ noteId: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { noteId } = await ctx.params;
  const parsed = assetUploadQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);

  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { id: true } });
  if (!note) return jsonError(404, 'note not found');

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.byteLength === 0) return jsonError(400, 'empty body');
  if (buffer.byteLength > MAX_ASSET_BYTES) return jsonError(413, 'file too large');

  const contentType = sniffImageType(buffer);
  if (contentType === null) return jsonError(415, 'unsupported file type');

  return withSpan('assets.upload', { 'asset.bytes': buffer.byteLength }, async () => {
    const asset = await prisma.asset.create({
      data: {
        noteId,
        authorId: user.id,
        kind: 'IMAGE',
        contentType,
        filename: parsed.data.filename,
        byteSize: buffer.byteLength,
        data: buffer,
      },
      select: { id: true },
    });
    await recordAudit({
      action: 'assets.uploaded',
      actorId: user.id,
      subject: asset.id,
      metadata: { noteId, contentType },
    });
    log.info({ assetId: asset.id, noteId, contentType }, 'asset uploaded');
    return jsonCreated({ id: asset.id, url: `/api/assets/${asset.id}` });
  });
};
