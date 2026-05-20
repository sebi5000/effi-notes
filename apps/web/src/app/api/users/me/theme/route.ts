import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { userThemeSchema } from '@/lib/api/schemas.ts';
import { setThemeCookie } from '@/lib/theme/theme-cookie.ts';
import { DEFAULT_THEME, isThemeId } from '@/lib/theme/themes.ts';

/**
 * Current user's theme preference (ADR 0029).
 *
 * GET — reads `User.theme`, reseeds the cookie cache, returns the value.
 * PUT — validates the body, updates `User.theme`, writes the cookie.
 * Theme is deliberately NOT in the session/JWT, so the cookie is the only
 * fast read for SSR; the DB is authoritative.
 */

const log = createLogger({ component: 'api.users.me.theme' });

export const GET = async (): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { theme: true },
  });
  // Validate the DB value through the closed set — a stale/unknown row value
  // falls back to the default instead of leaking into the response.
  const theme = isThemeId(row?.theme) ? row.theme : DEFAULT_THEME;
  // Reseed the render-fast cookie on every read so SSR stays correct.
  await setThemeCookie(theme);
  return jsonOk({ theme });
};

export const PUT = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = userThemeSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  await prisma.user.update({
    where: { id: user.id },
    data: { theme: parsed.data.theme },
  });
  await setThemeCookie(parsed.data.theme);
  log.info({ userId: user.id, theme: parsed.data.theme }, 'user theme updated');
  return jsonOk({ theme: parsed.data.theme });
};
