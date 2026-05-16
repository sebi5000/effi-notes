import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import type { AssetsSweepPayload } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import type { Job } from 'bullmq';

const log = createLogger({ component: 'processor.assets.sweep' });

/** Grace period — assets unreferenced longer than this are hard-deleted. */
const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Hard-deletes `Asset` rows that have stayed unreferenced past the 24-hour
 * grace period (their `unreferencedSince` was stamped by the note-body-save
 * reconcile and never cleared). Pure timestamp logic — no editor-schema
 * knowledge, so it stays clear of the ADR-0022 worker/schema split.
 * Runs as the hourly `assets.sweep` repeatable job.
 */
export const processAssetsSweep = async (job: Job<AssetsSweepPayload>): Promise<void> =>
  withSpan('assets.sweep', { 'job.id': job.id ?? '' }, async () => {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const { count } = await prisma.asset.deleteMany({
      where: { unreferencedSince: { lt: cutoff } },
    });
    await job.log(`assets.sweep deleted=${count} cutoff=${cutoff.toISOString()}`);
    if (count > 0) {
      log.info({ count }, 'swept unreferenced assets');
      await recordAudit({
        action: 'assets.swept',
        actorId: null,
        metadata: { count },
      });
    }
  });
