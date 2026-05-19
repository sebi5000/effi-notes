import { describe, expect, it } from 'vitest';
import { generatePublicToken } from './public-link-token.ts';

describe('generatePublicToken', () => {
  it('produces a URL-safe token (base64url charset only)', () => {
    expect(generatePublicToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces a 43-character token (256 bits, base64url, unpadded)', () => {
    expect(generatePublicToken()).toHaveLength(43);
  });

  it('produces distinct tokens across many calls', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generatePublicToken()));
    expect(tokens.size).toBe(500);
  });
});
