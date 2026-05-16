import { prisma } from '@app/db';
import type { PdfExtractPayload } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import type { Job } from 'bullmq';
import { processPdf } from './pdf-render.ts';

const log = createLogger({ component: 'processor.pdf.extract' });

/**
 * Extracts a PDF asset's text and renders its first-page preview, then writes
 * both (plus the page count) back to the `Asset` row. The generated
 * `searchVector` regenerates from the new `extractedText`. Idempotent — a
 * retry simply re-parses and overwrites. Enqueued by the asset upload route.
 */
export const processPdfExtract = async (job: Job<PdfExtractPayload>): Promise<void> =>
  withSpan(
    'pdf.extract',
    {
      'job.id': job.id ?? '',
      'asset.id': job.data.assetId,
      'job.attempt': job.attemptsMade,
    },
    async () => {
      const { assetId } = job.data;
      const asset = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { id: true, kind: true, data: true },
      });
      if (!asset || asset.kind !== 'PDF') {
        log.warn({ assetId }, 'pdf.extract — asset missing or not a PDF; skipping');
        return;
      }

      const { text, pageCount, previewPng } = await processPdf(new Uint8Array(asset.data));

      await prisma.asset.update({
        where: { id: assetId },
        data: {
          extractedText: text,
          pageCount,
          previewImage: new Uint8Array(previewPng),
          previewContentType: 'image/png',
        },
      });
      await job.log(`pdf.extract assetId=${assetId} pages=${pageCount} chars=${text.length}`);
      log.info({ assetId, pageCount, chars: text.length }, 'pdf extracted');
    },
  );
