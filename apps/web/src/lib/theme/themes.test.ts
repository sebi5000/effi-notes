import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, isThemeId, THEME_IDS, THEMES } from './themes.ts';

describe('isThemeId', () => {
  it.each(THEME_IDS)('accepts %s', (id) => {
    expect(isThemeId(id)).toBe(true);
  });

  const REJECTED: unknown[] = ['', 'unknown', null, undefined, 42, {}, []];
  it.each(REJECTED)('rejects %p', (value) => {
    expect(isThemeId(value)).toBe(false);
  });
});

describe('THEMES', () => {
  it('has metadata for every theme id', () => {
    for (const id of THEME_IDS) {
      const meta = THEMES[id];
      expect(meta.id).toBe(id);
      expect(typeof meta.i18nKey).toBe('string');
      expect(meta.preview.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(meta.preview.foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(meta.preview.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('DEFAULT_THEME is a valid theme id', () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
  });
});
