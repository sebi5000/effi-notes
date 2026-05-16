import { prisma } from '@app/db';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { resolveNoteAccess } from '@/lib/notes/access.ts';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const limitParam = new URL(req.url).searchParams.get('limit');
  const limit = Math.max(1, Math.min(100, Number(limitParam) || 25));

  const note = await prisma.note.findUnique({ where: { id }, select: { id: true } });
  if (!note) return jsonError(404, 'not found');

  const access = await resolveNoteAccess(user.id, id);
  if (access === null) return jsonError(403, 'forbidden');

  const history = await prisma.noteHistory.findMany({
    where: { noteId: id },
    select: {
      id: true,
      authorId: true,
      createdAt: true,
      body: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return jsonOk({
    history: history.map((h) => ({
      id: h.id,
      authorId: h.authorId,
      createdAt: h.createdAt.toISOString(),
      bodyLength: h.body.length,
    })),
  });
};
