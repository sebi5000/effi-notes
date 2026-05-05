import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { auth } from '@/auth';
import { defaultLocale, isLocale, type Locale } from './locales.ts';

/**
 * Server-side locale resolution. Order:
 *   1. Authenticated user's `locale` claim from the session (Keycloak)
 *   2. `NEXT_LOCALE` cookie
 *   3. `Accept-Language` header (first match against our supported list)
 *   4. Fallback to `defaultLocale` (`de`)
 *
 * No subpath routing — the template stays URL-agnostic so customer
 * projects can opt into `/de`, `/en` later without breaking deep links.
 */
export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = await loadMessages(locale);
  return { locale, messages };
});

const resolveLocale = async (): Promise<Locale> => {
  // 1. Session
  const session = await auth();
  if (isLocale(session?.user?.locale)) return session.user.locale;

  // 2. Cookie
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get('NEXT_LOCALE')?.value;
  if (isLocale(fromCookie)) return fromCookie;

  // 3. Accept-Language
  const headerStore = await headers();
  const accept = headerStore.get('accept-language') ?? '';
  for (const tag of accept.split(',')) {
    const lang = tag.split(';')[0]?.trim().split('-')[0];
    if (isLocale(lang)) return lang;
  }

  return defaultLocale;
};

// Dynamic import keeps each locale chunk separate — the bundle for `de`
// users does not include `en` strings.
const loadMessages = async (locale: Locale): Promise<Record<string, unknown>> => {
  const mod = (await import(`../../messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };
  return mod.default;
};
