import type { DemoJobPayload } from '@app/jobs/queues';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import type { Job } from 'bullmq';

const log = createLogger({ component: 'processor.demo' });

/**
 * Demo processor — proves the producer→Redis→worker wiring is alive.
 *
 * Customer projects replace this with real processors. The pattern:
 *   1. Validate the payload (BullMQ does NOT validate; we trust @app/jobs to)
 *   2. Wrap the work in `withSpan(...)` so traces correlate end-to-end
 *      (BullMQ has no auto-instrumentation — see ADR 0016)
 *   3. Use the structured logger; never `console.log` for job-level events
 *   4. Idempotent if at all possible — BullMQ retries on throw
 */
export const processDemoJob = async (
  job: Job<DemoJobPayload>,
): Promise<{ greeted: string; at: string }> =>
  withSpan(
    'demo.process',
    { 'job.id': job.id ?? '', 'job.queue': 'demo', 'job.attempt': job.attemptsMade },
    async () => {
      log.info({ jobId: job.id, message: job.data.message }, 'processing demo job');
      await job.log(`processing demo job: "${job.data.message}"`);
      // Pretend to do real work
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        greeted: job.data.message,
        at: new Date().toISOString(),
      };
    },
  );
