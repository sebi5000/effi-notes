import { describe, expect, it } from 'vitest';
import { PdfExtractJobSchema } from './queues.ts';

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
