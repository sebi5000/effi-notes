/** Per-kind byte caps. Enforced by the upload route. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

// reason: temporary alias — removed when Task 4 rewrites the upload route
export const MAX_ASSET_BYTES = MAX_IMAGE_BYTES;

/** The canonical MIME types this app accepts for image assets. */
export type SupportedImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** The asset kinds the upload route accepts (mirrors the Prisma `AssetKind`). */
export type AssetKindName = 'IMAGE' | 'PDF';

/** The canonical MIME types this app accepts. */
export type SupportedAssetType = SupportedImageType | 'application/pdf';

/**
 * Detect a supported image type from a file's leading magic bytes. Returns
 * the canonical MIME type, or `null` if the bytes are not one of the four
 * supported image formats. The upload route trusts this, NOT the
 * client-supplied Content-Type. SVG is intentionally unsupported
 * (inline-SVG XSS risk).
 */
export const sniffImageType = (bytes: Uint8Array): SupportedImageType | null => {
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

/** True when the body's leading bytes are the PDF signature `%PDF-`. */
const isPdf = (b: Uint8Array): boolean =>
  b.length >= 5 &&
  b[0] === 0x25 &&
  b[1] === 0x50 &&
  b[2] === 0x44 &&
  b[3] === 0x46 &&
  b[4] === 0x2d;

/**
 * Detect a supported asset type from a file's leading magic bytes. Returns
 * the canonical MIME type and the matching `AssetKind`, or `null` for an
 * unsupported body. The upload route trusts this, never the client header.
 */
export const sniffAssetType = (
  bytes: Uint8Array,
): { contentType: SupportedAssetType; kind: AssetKindName } | null => {
  const image = sniffImageType(bytes);
  if (image !== null) return { contentType: image, kind: 'IMAGE' };
  if (isPdf(bytes)) return { contentType: 'application/pdf', kind: 'PDF' };
  return null;
};

/** The byte cap for a given asset kind. */
export const maxBytesForKind = (kind: AssetKindName): number =>
  kind === 'PDF' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
