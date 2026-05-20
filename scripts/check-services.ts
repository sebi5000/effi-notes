#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: standalone CLI preflight script — stdout/stderr IS its UI; the app-code logger isn't appropriate here.
/**
 * Preflight for the integration test suite — verifies the Postgres + Redis
 * the tests need accept TCP connections before Vitest scrolls 800 setup
 * errors. Uses a plain socket probe (no `pg` / `ioredis` dependency) so the
 * script runs from a fresh checkout without hoisted workspace deps.
 *
 * Exits 0 when both services answer; non-zero with a single actionable
 * message otherwise. Wire it into `make test-integration` (or before any
 * `vitest run`) so the failure mode is "one line of guidance" rather than
 * a wall of teardown errors (QA review 2026-05-20, P3).
 */

import { spawnSync } from 'node:child_process';
import { Socket } from 'node:net';

type Endpoint = { host: string; port: number };

/** Extract host:port from a service URL — accepts both pg and redis URLs. */
const parseEndpoint = (raw: string, defaultPort: number): Endpoint => {
  try {
    const u = new URL(raw);
    return { host: u.hostname || 'localhost', port: u.port ? Number(u.port) : defaultPort };
  } catch {
    return { host: 'localhost', port: defaultPort };
  }
};

const POSTGRES = parseEndpoint(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/effi_notes_test',
  5432,
);
const REDIS = parseEndpoint(process.env.REDIS_URL ?? 'redis://localhost:6379', 6379);

/** Resolves true on TCP connect; resolves with a message on timeout / error. */
const tcpProbe = ({ host, port }: Endpoint, timeoutMs = 1500): Promise<true | string> =>
  new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const done = (result: true | string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(`timed out after ${timeoutMs}ms`));
    socket.once('error', (err) => done(err.message));
    socket.connect(port, host);
  });

const hint = (): string => {
  // `docker compose` may not be on PATH everywhere; only suggest `make up-dev`
  // when this checkout looks like it has the Makefile that exposes it.
  const probe = spawnSync('test', ['-f', 'Makefile'], { stdio: 'ignore' });
  return probe.status === 0
    ? 'Run `make up-dev` to start Postgres + Redis, then retry.'
    : 'Start a local Postgres on :5432 and Redis on :6379, then retry.';
};

const [pg, redis] = await Promise.all([tcpProbe(POSTGRES), tcpProbe(REDIS)]);
const failures: string[] = [];
if (pg !== true) failures.push(`postgres @ ${POSTGRES.host}:${POSTGRES.port} — ${pg}`);
if (redis !== true) failures.push(`redis @ ${REDIS.host}:${REDIS.port} — ${redis}`);

if (failures.length === 0) {
  console.log(
    `preflight ok — postgres @ ${POSTGRES.host}:${POSTGRES.port}, redis @ ${REDIS.host}:${REDIS.port}`,
  );
  process.exit(0);
}

console.error('preflight FAILED:');
for (const f of failures) console.error(`  • ${f}`);
console.error(`\n${hint()}`);
process.exit(1);
