import { describe, expect, it } from 'vitest';
import { MAX_ASSET_BYTES, sniffImageType } from './asset-mime.ts';

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
    expect(MAX_ASSET_BYTES).toBe(10 * 1024 * 1024);
  });
});
