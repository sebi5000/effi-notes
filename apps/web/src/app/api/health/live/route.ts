// Liveness probe — returns 200 as long as the Next.js process is running
// and reachable. NEVER touches dependencies (DB, Keycloak, Redis); the
// only failure mode is "process is dead", which Compose already detects
// at the process level. Used by orchestrators to decide on restart.

export const dynamic = 'force-dynamic';

export const GET = (): Response =>
  Response.json({ status: 'ok' }, { status: 200, headers: { 'cache-control': 'no-store' } });
