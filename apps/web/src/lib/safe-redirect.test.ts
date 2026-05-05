import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect.ts';

describe('safeRedirect', () => {
  it('accepts an absolute path', () => {
    expect(safeRedirect('/dashboard', '/x')).toBe('/dashboard');
    expect(safeRedirect('/admin/queues?from=here', '/x')).toBe('/admin/queues?from=here');
  });

  it('falls back when input is missing', () => {
    expect(safeRedirect(undefined, '/fallback')).toBe('/fallback');
    expect(safeRedirect(null, '/fallback')).toBe('/fallback');
    expect(safeRedirect('', '/fallback')).toBe('/fallback');
  });

  it('rejects absolute URLs (open-redirect attempt)', () => {
    expect(safeRedirect('https://evil.example/path', '/fallback')).toBe('/fallback');
    expect(safeRedirect('http://evil.example', '/fallback')).toBe('/fallback');
    expect(safeRedirect('javascript:alert(1)', '/fallback')).toBe('/fallback');
  });

  it('rejects protocol-relative URLs (browser treats as host)', () => {
    expect(safeRedirect('//evil.example/path', '/fallback')).toBe('/fallback');
    expect(safeRedirect('//evil.example', '/fallback')).toBe('/fallback');
  });

  it('rejects backslash-prefixed paths (some parsers interpret as scheme)', () => {
    expect(safeRedirect('/\\evil.example', '/fallback')).toBe('/fallback');
  });

  it('rejects paths with control characters', () => {
    expect(safeRedirect('/\nevil', '/fallback')).toBe('/fallback');
    expect(safeRedirect('/\x00evil', '/fallback')).toBe('/fallback');
  });

  it('rejects relative paths without leading slash', () => {
    expect(safeRedirect('dashboard', '/fallback')).toBe('/fallback');
    expect(safeRedirect('../etc', '/fallback')).toBe('/fallback');
  });

  it('rejects non-string input', () => {
    // @ts-expect-error -- the contract accepts string | null | undefined; this verifies runtime behaviour
    expect(safeRedirect(42, '/fallback')).toBe('/fallback');
  });
});
