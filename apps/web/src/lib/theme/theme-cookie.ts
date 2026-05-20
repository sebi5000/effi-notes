import { cookies } from 'next/headers';
import { DEFAULT_THEME, isThemeId, type ThemeId } from './themes.ts';

/**
 * Theme cookie helpers (ADR 0029). The cookie is a render-fast cache of the
 * `User.theme` DB column; layout reads it for FOUC-free SSR, and the theme
 * API writes it after a successful DB update. The DB is the source of truth.
 */

/** Cookie name. */
export const THEME_COOKIE = 'effi-notes:theme';

/** 1 year — themes are stable preferences. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Read the cookie, falling back to DEFAULT_THEME on missing/unknown values. */
export const readThemeCookie = async (): Promise<ThemeId> => {
  return (await peekThemeCookie()) ?? DEFAULT_THEME;
};

/**
 * Read the cookie without a fallback — returns `null` when absent or set to
 * an unknown value, so callers can distinguish "no cookie yet" from
 * "explicitly chose DEFAULT_THEME".
 */
export const peekThemeCookie = async (): Promise<ThemeId | null> => {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return isThemeId(value) ? value : null;
};

/** Write the cookie. Use from a route handler or server action. */
export const setThemeCookie = async (theme: ThemeId): Promise<void> => {
  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    maxAge: MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
};
