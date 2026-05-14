import { prisma } from '@app/db';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { createTagSchema, type TagItem } from '@/lib/api/schemas.ts';

const toItem = (t: { id: string; name: string; color: string | null }): TagItem => ({
  id: t.id,
  name: t.name,
  color: t.color,
});

export const GET = async (): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const tags = await prisma.tag.findMany({
    select: { id: true, name: true, color: true },
    orderBy: { name: 'asc' },
  });
  return jsonOk({ tags: tags.map(toItem) });
};

export const POST = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = createTagSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const existing = await prisma.tag.findUnique({
    where: { name: parsed.data.name },
    select: { id: true, name: true, color: true },
  });
  if (existing) return jsonOk(toItem(existing));

  const created = await prisma.tag.create({
    data: {
      name: parsed.data.name,
      ...(parsed.data.color === undefined || parsed.data.color === null
        ? {}
        : { color: parsed.data.color }),
    },
    select: { id: true, name: true, color: true },
  });
  return jsonCreated(toItem(created));
};
