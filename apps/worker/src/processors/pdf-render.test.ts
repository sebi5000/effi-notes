import { describe, expect, it } from 'vitest';
import { processPdf } from './pdf-render.ts';
import { makeSamplePdf } from './sample-pdf.fixture.ts';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe('processPdf', () => {
  it('extracts the text, page count, and a PNG preview', async () => {
    const pdf = makeSamplePdf('Findable PDF content');
    const result = await processPdf(new Uint8Array(pdf));

    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('Findable');
    expect(result.text).toContain('content');
    expect(result.previewPng.byteLength).toBeGreaterThan(0);
    expect([...result.previewPng.subarray(0, 4)]).toEqual(PNG_MAGIC);
  });
});
