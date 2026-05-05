import type { DemoJobPayload } from '@app/jobs/queues';
import type { Job } from 'bullmq';

/**
 * Demo processor — proves the producer→Redis→worker wiring is alive.
 *
 * Customer projects replace this with real processors. The pattern:
 *   1. Validate the payload (BullMQ does NOT validate; we trust @app/jobs to)
 *   2. Do the work, idempotently if at all possible
 *   3. Throw on retryable failure; the queue config in @app/jobs handles retries
 *   4. Return a serialisable result (or void)
 */
export const processDemoJob = async (
  job: Job<DemoJobPayload>,
): Promise<{ greeted: string; at: string }> => {
  await job.log(`processing demo job: "${job.data.message}"`);
  // Pretend to do real work
  await new Promise((resolve) => setTimeout(resolve, 250));
  return {
    greeted: job.data.message,
    at: new Date().toISOString(),
  };
};
