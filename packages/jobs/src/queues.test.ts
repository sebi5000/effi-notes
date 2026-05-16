import { afterAll, describe, expect, it } from 'vitest';
import { closeRedis } from './connection.ts';
import {
  enqueuePdfExtraction,
  getQueueForBullBoard,
  PdfExtractJobSchema,
  QUEUES,
} from './queues.ts';

describe('PdfExtractJobSchema', () => {
  it('accepts a non-empty assetId', () => {
    expect(PdfExtractJobSchema.parse({ assetId: 'abc123' })).toEqual({ assetId: 'abc123' });
  });

  it('rejects an empty assetId', () => {
    expect(PdfExtractJobSchema.safeParse({ assetId: '' }).success).toBe(false);
  });

  it('rejects a missing assetId', () => {
    expect(PdfExtractJobSchema.safeParse({}).success).toBe(false);
  });
});

describe('enqueuePdfExtraction (integration — real Redis)', () => {
  const testAssetId = `queues-test-${crypto.randomUUID()}`;
  let jobId: string | undefined;

  afterAll(async () => {
    const queue = getQueueForBullBoard(QUEUES.pdfExtract);
    if (jobId !== undefined) await queue.remove(jobId);
    await queue.close();
    await closeRedis();
  });

  // Regression guard: BullMQ rejects ':' in custom job ids ("Custom Id cannot
  // contain :"), which previously made every PDF upload 500. The producer must
  // build a colon-free jobId. This exercises the real BullMQ `.add()` — the
  // route tests mock `@app/jobs`, so nothing else covers this path.
  it('enqueues a job with a colon-free job id', async () => {
    jobId = await enqueuePdfExtraction({ assetId: testAssetId });
    expect(jobId).toBe(`pdf-extract-${testAssetId}`);
    expect(jobId).not.toContain(':');
  });
});
