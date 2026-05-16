import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, maxBytesForKind, sniffAssetType, sniffImageType } from './asset-mime.ts';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('sniffImageType', () => {
  it('detects PNG', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
  });
  it('detects JPEG', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });
  it('detects GIF', () => {
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
  });
  it('detects WebP', () => {
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe(
      'image/webp',
    );
  });
  it('rejects an unknown signature', () => {
    expect(sniffImageType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull(); // %PDF
  });
  it('rejects a too-short buffer', () => {
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
  });
  it('exposes a 10 MB cap', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('sniffAssetType', () => {
  it('detects a PDF from the %PDF- magic bytes', () => {
    expect(sniffAssetType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34))).toEqual({
      contentType: 'application/pdf',
      kind: 'PDF',
    });
  });

  it('detects a PNG image and reports the IMAGE kind', () => {
    expect(sniffAssetType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({
      contentType: 'image/png',
      kind: 'IMAGE',
    });
  });

  it('returns null for an unrecognised body', () => {
    expect(sniffAssetType(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
  });

  it('returns null for a long-enough body that is neither image nor PDF', () => {
    expect(sniffAssetType(bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06))).toBeNull();
  });
});

describe('maxBytesForKind', () => {
  it('caps images at 10 MB and PDFs at 25 MB', () => {
    expect(maxBytesForKind('IMAGE')).toBe(10 * 1024 * 1024);
    expect(maxBytesForKind('PDF')).toBe(25 * 1024 * 1024);
  });
});
