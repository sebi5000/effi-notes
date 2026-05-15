import { describe, expect, it } from 'vitest';
import { createTagSchema } from './schemas.ts';

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
