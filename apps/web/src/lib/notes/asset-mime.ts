/** Per-asset byte cap (10 MB). Enforced by the upload route. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/**
 * Detect a supported image type from a file's leading magic bytes. Returns
 * the canonical MIME type, or `null` if the bytes are not one of the four
 * supported image formats. The upload route trusts this, NOT the
 * client-supplied Content-Type. SVG is intentionally unsupported
 * (inline-SVG XSS risk).
 */
export const sniffImageType = (bytes: Uint8Array): string | null => {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'image/gif';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};
