import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { enqueuePdfExtraction } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, requireSession } from '@/lib/api/responses.ts';
import { assetUploadQuerySchema } from '@/lib/api/schemas.ts';
import { canEdit, resolveNoteAccess } from '@/lib/notes/access.ts';
import { MAX_PDF_BYTES, maxBytesForKind, sniffAssetType } from '@/lib/notes/asset-mime.ts';

const log = createLogger({ component: 'api.assets.upload' });

/**
 * POST /api/notes/[id]/assets — upload an image or PDF into a note.
 * The raw file bytes are the request body; the filename is `?filename=`.
 * The stored MIME type comes from the file's magic bytes, never the
 * client-supplied Content-Type.
 */
export const POST = async (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  // The route segment is `[id]` (consistent with the sibling /api/notes
  // routes); it is the note's id.
  const { id: noteId } = await ctx.params;
  const parsed = assetUploadQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);

  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { id: true } });
  if (!note) return jsonError(404, 'note not found');

  const access = await resolveNoteAccess(user.id, noteId);
  if (!canEdit(access)) return jsonError(403, 'forbidden');

  // Coarse pre-check from Content-Length: reject grossly oversized uploads
  // before buffering the request body into memory. The kind-specific limit
  // still applies after sniffing the actual bytes below (QA review
  // 2026-05-20, P3 — asset IO buffered).
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
    return jsonError(413, 'file too large');
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.byteLength === 0) return jsonError(400, 'empty body');

  const sniffed = sniffAssetType(buffer);
  if (sniffed === null) return jsonError(415, 'unsupported file type');
  if (buffer.byteLength > maxBytesForKind(sniffed.kind)) {
    return jsonError(413, 'file too large');
  }

  return withSpan(
    'assets.upload',
    { 'asset.bytes': buffer.byteLength, 'asset.kind': sniffed.kind },
    async () => {
      const asset = await prisma.asset.create({
        data: {
          noteId,
          authorId: user.id,
          kind: sniffed.kind,
          contentType: sniffed.contentType,
          filename: parsed.data.filename,
          byteSize: buffer.byteLength,
          data: buffer,
        },
        select: { id: true },
      });
      if (sniffed.kind === 'PDF') {
        await enqueuePdfExtraction({ assetId: asset.id });
      }
      await recordAudit({
        action: 'assets.uploaded',
        actorId: user.id,
        subject: asset.id,
        metadata: { noteId, contentType: sniffed.contentType },
      });
      log.info({ assetId: asset.id, noteId, contentType: sniffed.contentType }, 'asset uploaded');
      return jsonCreated({ id: asset.id, url: `/api/assets/${asset.id}` });
    },
  );
};
