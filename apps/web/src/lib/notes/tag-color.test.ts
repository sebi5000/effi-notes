import { describe, expect, it } from 'vitest';
import { tagColor } from './tag-color.ts';

describe('tagColor', () => {
  it('is deterministic — the same name always yields the same colour', () => {
    expect(tagColor('discovery')).toBe(tagColor('discovery'));
  });

  it('returns a 7-character hex colour', () => {
    expect(tagColor('anything')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('handles an empty string', () => {
    expect(tagColor('')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
