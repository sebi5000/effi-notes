/**
 * Theme contract (ADR 0029) — the closed set of selectable theme ids plus
 * display metadata. Imported by the Zod schema, the API route, the root
 * layout's theme resolver, and the settings page; one definition, no drift.
 */

export const THEME_IDS = ['warm-paper', 'dark', 'cool-slate'] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = 'warm-paper';

/** Type guard for un-trusted input (cookie, DB row, request body). */
export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);

/**
 * A small palette sample used by the settings preview cards — inlined as CSS
 * custom properties on each card so the preview shows the theme regardless of
 * the active `data-theme`. Keep this in sync with the `[data-theme]` blocks
 * in `globals.css`.
 */
export type ThemePreview = {
  background: string;
  foreground: string;
  accent: string;
  muted: string;
  paperLine: string;
};

export type ThemeMeta = {
  id: ThemeId;
  /** Key under `settings.themes.<…>` for the display name. */
  i18nKey: 'themeWarmPaper' | 'themeDark' | 'themeCoolSlate';
  preview: ThemePreview;
};

export const THEMES: Record<ThemeId, ThemeMeta> = {
  'warm-paper': {
    id: 'warm-paper',
    i18nKey: 'themeWarmPaper',
    preview: {
      background: '#faf6ee',
      foreground: '#1e2230',
      accent: '#c26a20',
      muted: '#f1ebdc',
      paperLine: '#ece5d2',
    },
  },
  dark: {
    id: 'dark',
    i18nKey: 'themeDark',
    preview: {
      background: '#15171f',
      foreground: '#e9e5d8',
      accent: '#e8b884',
      muted: '#1f2230',
      paperLine: '#2c303a',
    },
  },
  'cool-slate': {
    id: 'cool-slate',
    i18nKey: 'themeCoolSlate',
    preview: {
      background: '#f3f5fa',
      foreground: '#1a2236',
      accent: '#2d6cb8',
      muted: '#e4eaf3',
      paperLine: '#d6dde9',
    },
  },
};
