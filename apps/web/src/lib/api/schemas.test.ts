import { describe, expect, it } from 'vitest';
import { assetUploadQuerySchema, createTagSchema, patchCaptionSchema } from './schemas.ts';

describe('createTagSchema — tag name', () => {
  it('accepts a plain name', () => {
    expect(createTagSchema.safeParse({ name: 'discovery' }).success).toBe(true);
  });

  it('accepts a nested name with # separators', () => {
    expect(createTagSchema.safeParse({ name: 'discovery#new#01' }).success).toBe(true);
  });

  it('rejects a leading #', () => {
    expect(createTagSchema.safeParse({ name: '#discovery' }).success).toBe(false);
  });

  it('rejects a trailing #', () => {
    expect(createTagSchema.safeParse({ name: 'discovery#' }).success).toBe(false);
  });

  it('rejects a doubled ##', () => {
    expect(createTagSchema.safeParse({ name: 'discovery##new' }).success).toBe(false);
  });

  it('still rejects spaces', () => {
    expect(createTagSchema.safeParse({ name: 'has spaces' }).success).toBe(false);
  });

  it('accepts a name with unicode letters', () => {
    expect(createTagSchema.safeParse({ name: 'café#découverte' }).success).toBe(true);
  });
});

describe('asset schemas', () => {
  it('assetUploadQuerySchema accepts a filename', () => {
    const r = assetUploadQuerySchema.safeParse({ filename: 'photo.png' });
    expect(r.success).toBe(true);
  });

  it('assetUploadQuerySchema rejects a missing filename', () => {
    expect(assetUploadQuerySchema.safeParse({}).success).toBe(false);
  });

  it('assetUploadQuerySchema rejects an over-long filename', () => {
    expect(assetUploadQuerySchema.safeParse({ filename: 'x'.repeat(300) }).success).toBe(false);
  });

  it('patchCaptionSchema accepts a caption', () => {
    expect(patchCaptionSchema.safeParse({ caption: 'A photo' }).success).toBe(true);
    expect(patchCaptionSchema.safeParse({ caption: '' }).success).toBe(true);
  });

  it('patchCaptionSchema rejects an over-long caption', () => {
    expect(patchCaptionSchema.safeParse({ caption: 'x'.repeat(2000) }).success).toBe(false);
  });
});
