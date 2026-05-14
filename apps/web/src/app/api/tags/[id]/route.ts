import { prisma } from '@app/db';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const existing = await prisma.tag.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError(404, 'not found');

  await prisma.tag.delete({ where: { id } });
  return jsonOk({ deleted: true });
};
