/** Smallest width an image may be resized to, in pixels. */
export const MIN_IMAGE_WIDTH = 80;

/**
 * Clamp a desired image width (px) so it never goes below MIN_IMAGE_WIDTH
 * and never exceeds the available editor content width. A non-finite
 * `desired` falls back to the available width. The result is rounded to a
 * whole pixel. CSS `max-width: 100%` is the independent hard backstop;
 * this keeps the stored `width` attribute sane.
 */
export const clampImageWidth = (desired: number, available: number): number => {
  const safeAvailable = Number.isFinite(available) ? available : MIN_IMAGE_WIDTH;
  const max = Math.max(MIN_IMAGE_WIDTH, Math.floor(safeAvailable));
  if (!Number.isFinite(desired)) return max;
  return Math.min(max, Math.max(MIN_IMAGE_WIDTH, Math.round(desired)));
};
