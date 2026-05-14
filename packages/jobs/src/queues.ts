import { type JobsOptions, Queue } from 'bullmq';
import { z } from 'zod';
import { getRedis } from './connection.ts';

/**
 * Single source of truth for queue names. The web app and worker both
 * import from this module — keeping queue names typed and consistent
 * across producer and consumer is the whole point of @app/jobs.
 *
 * Adding a queue: append to `QUEUES`, define its payload schema, export
 * a typed `add*` helper. Then implement the processor in apps/worker.
 */
export const QUEUES = {
  demo: 'demo',
  notesSnapshot: 'notes.snapshot',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ── demo queue ──────────────────────────────────────────────────────────────
export const DemoJobSchema = z.object({
  message: z.string().min(1),
  /** Internal user id of the actor that triggered the job (for audit). */
  triggeredBy: z.string(),
});
export type DemoJobPayload = z.infer<typeof DemoJobSchema>;

// ── notes.snapshot queue ────────────────────────────────────────────────────
// Debounces yjs persistence writes. The y-websocket server in the worker
// enqueues one job per (noteId, idle window) with `jobId: noteId` so BullMQ
// collapses bursts.
export const NotesSnapshotJobSchema = z.object({
  noteId: z.string().min(1),
  actorId: z.string().min(1).nullable(),
});
export type NotesSnapshotPayload = z.infer<typeof NotesSnapshotJobSchema>;

const defaultJobOpts: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

let demoQueue: Queue<DemoJobPayload> | undefined;
const getDemoQueue = (): Queue<DemoJobPayload> => {
  if (demoQueue) return demoQueue;
  demoQueue = new Queue<DemoJobPayload>(QUEUES.demo, {
    connection: getRedis(),
    defaultJobOptions: defaultJobOpts,
  });
  return demoQueue;
};

/** Producer entry point used by the web app. Validates payload via Zod. */
export const enqueueDemoJob = async (
  payload: DemoJobPayload,
  opts?: Pick<JobsOptions, 'jobId' | 'delay' | 'priority'>,
): Promise<string> => {
  const validated = DemoJobSchema.parse(payload);
  const job = await getDemoQueue().add('say-hello', validated, opts);
  return job.id ?? '';
};

/** Snapshot of queue depth for dashboard display. Cheap (single Redis call). */
export const getDemoQueueCounts = async (): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> => {
  const counts = await getDemoQueue().getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
};

/** Worker-side accessor — used by Bull Board mounting and the processor. */
export const getQueueForBullBoard = (name: QueueName): Queue => {
  if (name === QUEUES.demo) return getDemoQueue() as Queue;
  if (name === QUEUES.notesSnapshot) return getNotesSnapshotQueue() as Queue;
  throw new Error(`Unknown queue: ${name as string}`);
};

// ── notes.snapshot producer ─────────────────────────────────────────────────
const notesSnapshotJobOpts: JobsOptions = {
  // Snapshot bursts are cheap to retry; keep attempts low to avoid pile-ups
  // when DB is down for a deploy.
  attempts: 2,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 3600, count: 200 },
  removeOnFail: { age: 86_400 },
};

let notesSnapshotQueue: Queue<NotesSnapshotPayload> | undefined;
const getNotesSnapshotQueue = (): Queue<NotesSnapshotPayload> => {
  if (notesSnapshotQueue) return notesSnapshotQueue;
  notesSnapshotQueue = new Queue<NotesSnapshotPayload>(QUEUES.notesSnapshot, {
    connection: getRedis(),
    defaultJobOptions: notesSnapshotJobOpts,
  });
  return notesSnapshotQueue;
};

export const enqueueNotesSnapshot = async (
  payload: NotesSnapshotPayload,
  opts?: Pick<JobsOptions, 'delay'>,
): Promise<string> => {
  const validated = NotesSnapshotJobSchema.parse(payload);
  // Use `jobId = noteId` so BullMQ collapses bursts within the debounce
  // window into a single pending job.
  const job = await getNotesSnapshotQueue().add('snapshot', validated, {
    ...opts,
    jobId: `snapshot:${validated.noteId}`,
  });
  return job.id ?? '';
};
