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
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ── demo queue ──────────────────────────────────────────────────────────────
export const DemoJobSchema = z.object({
  message: z.string().min(1),
  /** Internal user id of the actor that triggered the job (for audit). */
  triggeredBy: z.string(),
});
export type DemoJobPayload = z.infer<typeof DemoJobSchema>;

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
  throw new Error(`Unknown queue: ${name as string}`);
};
