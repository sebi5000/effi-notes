import { prisma } from '@app/db';
import type { PdfExtractPayload } from '@app/jobs';
import type { Job } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processPdfExtract } from './pdf-extract.ts';
import { makeSamplePdf } from './sample-pdf.fixture.ts';

const TEST_PREFIX = 'pdf-extract-';

const cleanup = async () => {
  await prisma.asset.deleteMany({
    where: { note: { author: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.note.deleteMany({ where: { author: { email: { startsWith: TEST_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
};

const seed = async (pdf: Buffer) => {
  const user = await prisma.user.create({
    data: {
      keycloakSub: `${TEST_PREFIX}sub-${crypto.randomUUID()}`,
      email: `${TEST_PREFIX}${crypto.randomUUID()}@example.invalid`,
      displayName: 'Pdf',
      roles: ['user'],
    },
  });
  const note = await prisma.note.create({ data: { title: 'pdf-note', authorId: user.id } });
  return prisma.asset.create({
    data: {
      noteId: note.id,
      authorId: user.id,
      kind: 'PDF',
      contentType: 'application/pdf',
      filename: 'doc.pdf',
      byteSize: pdf.byteLength,
      data: new Uint8Array(pdf),
    },
  });
};

const fakeJob = (assetId: string): Job<PdfExtractPayload> =>
  ({
    id: crypto.randomUUID(),
    data: { assetId },
    log: async () => undefined,
  }) as unknown as Job<PdfExtractPayload>;

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('processPdfExtract', () => {
  it('writes extracted text, a preview PNG, and the page count', async () => {
    const asset = await seed(makeSamplePdf('Indexable body words'));
    await processPdfExtract(fakeJob(asset.id));

    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.extractedText).toContain('Indexable');
    expect(reloaded.pageCount).toBe(1);
    expect(reloaded.previewContentType).toBe('image/png');
    expect(reloaded.previewImage?.byteLength ?? 0).toBeGreaterThan(0);
  });

  it('is idempotent — a second run overwrites with the same result', async () => {
    const asset = await seed(makeSamplePdf('Repeatable text'));
    await processPdfExtract(fakeJob(asset.id));
    await processPdfExtract(fakeJob(asset.id));
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.extractedText).toContain('Repeatable');
  });

  it('is a no-op for a missing asset', async () => {
    await expect(processPdfExtract(fakeJob('does-not-exist'))).resolves.toBeUndefined();
  });
});
