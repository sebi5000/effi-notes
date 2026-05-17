import { describe, expect, it } from 'vitest';
import { nextAutoTitle } from './auto-title.ts';

describe('nextAutoTitle', () => {
  it('returns the first heading when the title is not manually set', () => {
    expect(nextAutoTitle('My Heading', 'Neue Notiz', false)).toBe('My Heading');
  });

  it('returns null when the title is manually set', () => {
    expect(nextAutoTitle('My Heading', 'Neue Notiz', true)).toBeNull();
  });

  it('returns null when there is no heading', () => {
    expect(nextAutoTitle(undefined, 'Neue Notiz', false)).toBeNull();
    expect(nextAutoTitle('   ', 'Neue Notiz', false)).toBeNull();
  });

  it('returns null when the heading already equals the title', () => {
    expect(nextAutoTitle('Same', 'Same', false)).toBeNull();
  });

  it('trims the heading', () => {
    expect(nextAutoTitle('  Spaced  ', 'Neue Notiz', false)).toBe('Spaced');
  });
});
