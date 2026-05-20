import { prisma } from '@app/db';
import { auth } from '@/auth';
import { peekThemeCookie } from './theme-cookie.ts';
import { DEFAULT_THEME, isThemeId, type ThemeId } from './themes.ts';

/**
 * Resolve the theme for the current request (ADR 0029) — the theme analogue
 * of i18n/request.ts's `resolveLocale`.
 *
 * Order:
 *   1. The theme cookie — cheap; the common path.
 *   2. If no cookie and the user is authenticated, the DB row (`User.theme`).
 *   3. `DEFAULT_THEME`.
 *
 * The DB read is gated behind the cookie-absent path, so an authenticated
 * request with a cookie is a single cookie read with no Prisma hit. The
 * theme API writes the cookie on every read/update, so the cookie
 * self-heals on the first authenticated request.
 */
export const resolveTheme = async (): Promise<ThemeId> => {
  const fromCookie = await peekThemeCookie();
  if (fromCookie !== null) return fromCookie;

  try {
    const session = await auth();
    if (session?.user?.id) {
      const row = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { theme: true },
      });
      if (isThemeId(row?.theme)) return row.theme;
    }
  } catch {
    // auth() or DB unavailable — fall through to the default; never crash render.
  }

  return DEFAULT_THEME;
};
