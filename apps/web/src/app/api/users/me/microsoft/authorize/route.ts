import { jsonError, requireSession } from '@/lib/api/responses.ts';
import { buildAuthorizeUrl, isMicrosoftConfigured, signState } from '@/lib/microsoft/oauth.ts';

/**
 * GET /api/users/me/microsoft/authorize — Settings UI redirects the browser
 * here when the user clicks "Connect Microsoft 365". We mint a signed state
 * carrying the Keycloak user id and bounce to Microsoft's authorize page
 * (ADR 0031).
 *
 * The state binds this OAuth flow to *this* user — even if the state is
 * leaked, the callback re-checks `auth()` against it before persisting.
 */
export const GET = async (): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  if (!isMicrosoftConfigured()) return jsonError(501, 'microsoft 365 is not configured');

  const state = signState(user.id);
  return Response.redirect(buildAuthorizeUrl(state), 302);
};
