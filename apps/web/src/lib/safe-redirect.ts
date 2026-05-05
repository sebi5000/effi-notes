/**
 * Returns `path` only if it is a same-origin path safe to use as a
 * post-login destination. Otherwise returns `fallback`.
 *
 * auth.js validates `redirectTo` against `AUTH_URL`, but we add a layer
 * of defence at the entry point (the `/login?from=...` query) so:
 *   - Logs and audit trails carry an already-validated value
 *   - Any future caller that bypasses auth.js gets the same protection
 *
 * Rejects:
 *   - Absolute URLs (`https://evil.com/x`) — protocol-bearing strings
 *   - Protocol-relative URLs (`//evil.com/x`) — browsers treat as host
 *   - Empty / non-string input
 *   - Anything that doesn't start with a single `/`
 */
export const safeRedirect = (path: string | null | undefined, fallback: string): string => {
  if (typeof path !== 'string') return fallback;
  if (path.length === 0) return fallback;
  if (!path.startsWith('/')) return fallback;
  if (path.startsWith('//')) return fallback;
  if (path.startsWith('/\\')) return fallback; // backslash-prefixed (some parsers)
  // Control characters (0x00–0x1F). Checked via charCodeAt because Biome
  // disallows control chars inside regex literals.
  for (let i = 0; i < path.length; i += 1) {
    if (path.charCodeAt(i) < 0x20) return fallback;
  }
  return path;
};
