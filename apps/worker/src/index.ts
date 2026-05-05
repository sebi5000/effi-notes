import { env } from '@app/config/env';
import { closeRedis, getRedis, QUEUES } from '@app/jobs';
import { Worker } from 'bullmq';
import { buildBullBoardRoutes } from './bull-board.ts';
import { processDemoJob } from './processors/demo.ts';

const startedAt = new Date().toISOString();

// ── Workers ────────────────────────────────────────────────────────────────
// One Worker per queue. Each carries its own connection (BullMQ recommends
// not sharing across workers). Adding a queue: register it in @app/jobs,
// import its processor here, instantiate a Worker.
const demoWorker = new Worker(QUEUES.demo, processDemoJob, {
  connection: getRedis(),
  concurrency: env.WORKER_CONCURRENCY,
});

demoWorker.on('failed', (job, err) => {
  console.error(`[worker] demo job ${job?.id ?? '?'} failed: ${err.message}`);
});

demoWorker.on('error', (err) => {
  console.error(`[worker] demo worker error: ${err.message}`);
});

// ── Internal HTTP server ──────────────────────────────────────────────────
// Hosts Bull Board under /admin/queues. NEVER exposed to the public —
// apps/web proxies to this port behind auth.js + ops-role middleware.
// Also serves /health/live and /health/ready so Compose can probe it.
const server = Bun.serve({
  port: env.WORKER_HTTP_PORT,
  routes: {
    '/health/live': () => Response.json({ status: 'ok' }),
    '/health/ready': async () => {
      try {
        await getRedis().ping();
        return Response.json({ status: 'ok' });
      } catch (err) {
        return Response.json(
          { status: 'degraded', redis: err instanceof Error ? err.message : 'unknown' },
          { status: 503 },
        );
      }
    },
    ...buildBullBoardRoutes(),
  },
  fetch() {
    return new Response('Not found', { status: 404 });
  },
});

console.warn(
  `[worker] started at ${startedAt} — concurrency=${env.WORKER_CONCURRENCY}, http=${server.port}`,
);

// ── Graceful shutdown ──────────────────────────────────────────────────────
const shutdown = async (signal: string): Promise<void> => {
  console.warn(`[worker] received ${signal}, draining`);
  try {
    await demoWorker.close();
    server.stop();
    await closeRedis();
  } catch (err) {
    console.error(`[worker] shutdown error: ${err instanceof Error ? err.message : err}`);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
