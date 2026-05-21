import { prisma } from '@app/db';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { isMicrosoftConfigured } from '@/lib/microsoft/oauth.ts';

/**
 * GET /api/users/me/microsoft/status — used by the Settings card to decide
 * which branch to render (Connect vs. Disconnect) and by the editor's `$$`
 * overlay to decide whether the feature is available at all (ADR 0031).
 *
 * Response shape:
 *   { configured: boolean,  // env-level: customer has set the M365 vars
 *     connected:  boolean,  // user-level: a MicrosoftAccount row exists
 *     upn?: string,         // display label when connected
 *     connectedAt?: string  // ISO timestamp when connected }
 */
export const GET = async (): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const configured = isMicrosoftConfigured();
  if (!configured) {
    return jsonOk({ configured: false, connected: false });
  }

  const account = await prisma.microsoftAccount.findUnique({
    where: { userId: user.id },
    select: { upn: true, connectedAt: true },
  });
  if (!account) {
    return jsonOk({ configured: true, connected: false });
  }
  return jsonOk({
    configured: true,
    connected: true,
    ...(account.upn ? { upn: account.upn } : {}),
    connectedAt: account.connectedAt.toISOString(),
  });
};
