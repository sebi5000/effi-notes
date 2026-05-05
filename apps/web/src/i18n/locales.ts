/**
 * Locales the template ships with. Customer projects extend this list AND
 * add the matching JSON message file under `apps/web/messages/`. Keep both
 * lists in sync — the i18n-extractor subagent verifies it.
 */
export const locales = ['de', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'de';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (locales as ReadonlyArray<string>).includes(value);
