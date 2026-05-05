import { prisma } from '@app/db';

// Readiness probe — returns 200 only when the process can serve real
// traffic, i.e. the database is reachable. Used by orchestrators to
// decide on routing traffic (e.g. behind a load balancer).
//
// Intentionally does NOT ping Keycloak: Keycloak being down means
// nobody can sign in, but already-authenticated sessions still work
// because we use JWT sessions. Marking the app NotReady on Keycloak
// downtime would cause unnecessary churn.

export const dynamic = 'force-dynamic';

export const GET = async (): Promise<Response> => {
  const checks: Record<string, 'ok' | string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (err) {
    checks.database = err instanceof Error ? err.message : 'unknown error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');
  return Response.json(
    { status: allOk ? 'ok' : 'degraded', checks },
    { status: allOk ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
};
