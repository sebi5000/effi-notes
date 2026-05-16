import { prisma } from '@app/db';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type UserSearchHit, userSearchQuerySchema } from '@/lib/api/schemas.ts';

const RESULT_LIMIT = 20;

/** GET /api/users?q= — searches the User mirror for share-dialog grantee picking. */
export const GET = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const parsed = userSearchQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);
  const { q } = parsed.data;

  const users = await prisma.user.findMany({
    where: {
      id: { not: user.id },
      OR: [
        { displayName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, displayName: true, email: true },
    orderBy: { displayName: 'asc' },
    take: RESULT_LIMIT,
  });
  return jsonOk({ users: users satisfies UserSearchHit[] });
};
