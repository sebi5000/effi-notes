/**
 * Viewport breakpoints for the responsive notes layout, as `matchMedia`
 * query strings. Below each width the corresponding region auto-collapses
 * (see `useResponsiveCollapse`).
 *
 * `main` padding has its own breakpoint in CSS — Tailwind's `xl` (1280px),
 * which coincides with the sidebar breakpoint below.
 */

/** Below 1280px the sidebar auto-collapses. */
export const SIDEBAR_NARROW_QUERY = '(max-width: 1279px)';

/** Below 1440px the editor's document panel auto-collapses. */
export const DOC_PANEL_NARROW_QUERY = '(max-width: 1439px)';
