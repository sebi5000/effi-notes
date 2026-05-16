import { prisma } from '@app/db';
import { jsonError, requireSession } from '@/lib/api/responses.ts';
import { resolveNoteAccess } from '@/lib/notes/access.ts';

/**
 * GET /api/assets/[id]/preview — serve a PDF asset's rendered first-page
 * preview PNG (auth-gated). `404` until the `pdf.extract` worker job has
 * populated `previewImage`. Built for sub-project C's document panel.
 */
export const GET = async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { previewImage: true, previewContentType: true, noteId: true },
  });
  if (!asset) return jsonError(404, 'preview not found');

  const access = await resolveNoteAccess(user.id, asset.noteId);
  if (access === null) return jsonError(403, 'forbidden');

  if (asset.previewImage === null || asset.previewContentType === null) {
    return jsonError(404, 'preview not found');
  }

  return new Response(Buffer.from(asset.previewImage), {
    status: 200,
    headers: {
      'content-type': asset.previewContentType,
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
};
