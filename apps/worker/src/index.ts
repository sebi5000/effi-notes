// MUST be the very first import — sets up OTel before anything is patched.
import './instrumentation.ts';

import { env } from '@app/config/env';
import { closeRedis, getRedis, QUEUES } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import { Worker } from 'bullmq';
import { buildBullBoardRoutes } from './bull-board.ts';
import { processDemoJob } from './processors/demo.ts';
import { processNotesSnapshot } from './processors/notes-snapshot.ts';
import { processPdfExtract } from './processors/pdf-extract.ts';
import { authenticateUpgrade, handleMessage, onSocketOpen } from './yjs/server.ts';

const log = createLogger({ component: 'worker' });
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
  log.error({ jobId: job?.id, err: err.message, queue: QUEUES.demo }, 'job failed');
});

demoWorker.on('error', (err) => {
  log.error({ err: err.message, queue: QUEUES.demo }, 'worker error');
});

const snapshotWorker = new Worker(QUEUES.notesSnapshot, processNotesSnapshot, {
  connection: getRedis(),
  // Snapshots are cheap and serial — one at a time is plenty and avoids races
  // on the same noteId.
  concurrency: 1,
});

snapshotWorker.on('failed', (job, err) => {
  log.error(
    { jobId: job?.id, err: err.message, queue: QUEUES.notesSnapshot },
    'snapshot job failed',
  );
});

snapshotWorker.on('error', (err) => {
  log.error({ err: err.message, queue: QUEUES.notesSnapshot }, 'snapshot worker error');
});

const pdfExtractWorker = new Worker(QUEUES.pdfExtract, processPdfExtract, {
  connection: getRedis(),
  // PDF parsing + rasterising is CPU-heavy; keep concurrency modest.
  concurrency: 2,
});

pdfExtractWorker.on('failed', (job, err) => {
  log.error(
    { jobId: job?.id, err: err.message, queue: QUEUES.pdfExtract },
    'pdf extraction job failed',
  );
});

pdfExtractWorker.on('error', (err) => {
  log.error({ err: err.message, queue: QUEUES.pdfExtract }, 'pdf extraction worker error');
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

// ── y-websocket relay ──────────────────────────────────────────────────────
// Lives on its own port so the existing /admin/queues HTTP server stays
// uncluttered. Caddy routes /yjs/* here in prod; the dev compose override
// maps the port to the host so the browser can connect directly.
type WsAttach = { close: () => void; conn: { noteId: string; userId: string } };
const yServer = Bun.serve<WsAttach, never>({
  port: env.COLLAB_WS_PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    const result = authenticateUpgrade({
      pathname: url.pathname,
      searchParams: url.searchParams,
      secret: env.AUTH_SECRET,
    });
    if (!result.ok) {
      log.warn({ pathname: url.pathname, reason: result.reason }, 'yjs upgrade rejected');
      return new Response('Unauthorised', { status: 401 });
    }
    const upgraded = server.upgrade(req, {
      data: {
        // attached lazily on first message — see open() below
        close: () => undefined,
        conn: { noteId: result.noteId, userId: result.userId },
      } satisfies WsAttach,
    });
    if (upgraded) return undefined;
    return new Response('Upgrade failed', { status: 500 });
  },
  websocket: {
    async open(ws) {
      const wrapper = {
        send: (data: Uint8Array) => ws.send(data),
        close: (code?: number, reason?: string) => ws.close(code, reason),
      };
      const close = await onSocketOpen({
        noteId: ws.data.conn.noteId,
        userId: ws.data.conn.userId,
        socket: wrapper,
      });
      ws.data.close = close;
    },
    async message(ws, raw) {
      const data =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === 'string'
            ? new TextEncoder().encode(raw)
            : new Uint8Array(raw);
      await handleMessage(
        {
          noteId: ws.data.conn.noteId,
          userId: ws.data.conn.userId,
          socket: {
            send: (d: Uint8Array) => ws.send(d),
            close: (code?: number, reason?: string) => ws.close(code, reason),
          },
        },
        data,
      );
    },
    close(ws) {
      ws.data.close();
    },
  },
});

log.info(
  { startedAt, concurrency: env.WORKER_CONCURRENCY, http: server.port, yjs: yServer.port },
  'worker started',
);

// ── Graceful shutdown ──────────────────────────────────────────────────────
const shutdown = async (signal: string): Promise<void> => {
  log.warn({ signal }, 'draining worker');
  try {
    await demoWorker.close();
    await snapshotWorker.close();
    await pdfExtractWorker.close();
    server.stop();
    yServer.stop();
    await closeRedis();
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'shutdown error');
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
