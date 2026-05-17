import { describe, expect, it } from 'vitest';
import { toSnippet } from './snippet.ts';

describe('toSnippet', () => {
  it('collapses whitespace and newlines into single spaces', () => {
    expect(toSnippet('hello\n\n  world\tagain')).toBe('hello world again');
  });

  it('trims leading/trailing whitespace', () => {
    expect(toSnippet('   padded   ')).toBe('padded');
  });

  it('returns an empty string for an empty body', () => {
    expect(toSnippet('')).toBe('');
    expect(toSnippet('   \n  ')).toBe('');
  });

  it('caps the result at 140 characters', () => {
    const long = 'x'.repeat(500);
    expect(toSnippet(long)).toHaveLength(140);
  });
});
