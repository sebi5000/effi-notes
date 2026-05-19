import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type PublicLinkView, publicLinkCreateSchema } from '@/lib/api/schemas.ts';
import { canManageShares, resolveNoteAccess } from '@/lib/notes/access.ts';
import { generatePublicToken } from '@/lib/notes/public-link-token.ts';
import { ttlToExpiresAt } from '@/lib/notes/share-ttl.ts';

/**
 * Manage a note's public link (ADR 0028). Generating or revoking a public link
 * requires `canManageShares` on the note — the same bar as a per-user share.
 * The account-less viewer at `/p/[token]` is handled separately and queries
 * Prisma directly; it never touches this route.
 */

const log = createLogger({ component: 'api.notes.public-link' });
type RouteContext = { params: Promise<{ id: string }> };

const toPublicLinkView = (link: {
  id: string;
  token: string;
  expiresAt: Date | null;
  createdAt: Date;
}): PublicLinkView => ({
  id: link.id,
  token: link.token,
  // Relative path — the client composes the absolute URL with its own origin,
  // which sidesteps proxy host-detection on the server.
  url: `/p/${link.token}`,
  expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
  createdAt: link.createdAt.toISOString(),
});

const linkSelect = { id: true, token: true, expiresAt: true, createdAt: true } as const;

/** Shared guard: 401 unauthenticated, 404 missing note, 403 if not a manager. */
const guard = async (noteId: string): Promise<{ userId: string } | { error: Response }> => {
  const user = await requireSession();
  if (!user) return { error: jsonError(401, 'unauthorised') };
  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { id: true } });
  if (!note) return { error: jsonError(404, 'not found') };
  const access = await resolveNoteAccess(user.id, noteId);
  if (!canManageShares(access)) return { error: jsonError(403, 'forbidden') };
  return { userId: user.id };
};

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ('error' in g) return g.error;

  const link = await prisma.publicLink.findUnique({ where: { noteId: id }, select: linkSelect });
  return jsonOk({ link: link ? toPublicLinkView(link) : null });
};

export const POST = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ('error' in g) return g.error;

  // An empty body is valid — it means "no expiry".
  let payload: unknown = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const parsed = publicLinkCreateSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const expiresAt = ttlToExpiresAt(parsed.data.ttl);
  // Upsert on the unique noteId — regenerating mints a fresh token and discards
  // the old one, so any previously distributed URL stops working immediately.
  const link = await prisma.publicLink.upsert({
    where: { noteId: id },
    create: { noteId: id, token: generatePublicToken(), expiresAt, createdById: g.userId },
    update: { token: generatePublicToken(), expiresAt, createdById: g.userId },
    select: linkSelect,
  });
  await recordAudit({
    action: 'publicLink.created',
    actorId: g.userId,
    subject: link.id,
    metadata: { noteId: id },
  });
  log.info({ publicLinkId: link.id, noteId: id, userId: g.userId }, 'public link created');
  return jsonCreated(toPublicLinkView(link));
};

export const DELETE = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ('error' in g) return g.error;

  const existing = await prisma.publicLink.findUnique({
    where: { noteId: id },
    select: { id: true },
  });
  if (existing) {
    await prisma.publicLink.delete({ where: { noteId: id } });
    await recordAudit({
      action: 'publicLink.revoked',
      actorId: g.userId,
      subject: existing.id,
      metadata: { noteId: id },
    });
    log.info({ publicLinkId: existing.id, noteId: id, userId: g.userId }, 'public link revoked');
  }
  return jsonOk({ revoked: existing !== null });
};
