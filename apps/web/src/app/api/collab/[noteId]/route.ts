import { createHmac } from 'node:crypto';
import { env } from '@app/config/env';
import { prisma } from '@app/db';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { atLeast, resolveNoteAccess } from '@/lib/notes/access.ts';

type RouteContext = { params: Promise<{ noteId: string }> };

/**
 * GET /api/collab/[noteId] — issues a short-lived signed token the browser
 * uses to open the y-websocket session.
 *
 * The auth.js session is verified here; the worker then re-verifies the
 * signed token (HMAC of `noteId:userId:exp` using AUTH_SECRET). The token
 * lives 60 seconds — long enough to complete the WS upgrade, short enough
 * that a leaked URL is replay-resistant.
 *
 * Token-issuance lives in the web app rather than the worker because only
 * the web app has the user session. The shared secret (AUTH_SECRET) means
 * worker and web don't need to share any other state.
 */

const TTL_SECONDS = 60;

const b64u = (buf: Buffer): string =>
  buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { noteId } = await ctx.params;

  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { id: true } });
  if (!note) return jsonError(404, 'note not found');

  const access = await resolveNoteAccess(user.id, noteId);
  if (access === null) return jsonError(403, 'forbidden');
  const tokenAccess = atLeast(access, 'EDIT') ? 'w' : 'r';

  if (noteId.includes(':') || user.id.includes(':')) {
    return jsonError(500, 'invalid identifier');
  }

  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${noteId}:${user.id}:${tokenAccess}:${exp}`;
  const sig = b64u(createHmac('sha256', env.AUTH_SECRET).update(payload).digest());
  const token = `${payload}:${sig}`;

  return jsonOk({
    url: `${env.COLLAB_PUBLIC_URL}/yjs/${noteId}?token=${encodeURIComponent(token)}`,
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
  });
};
