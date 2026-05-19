import { randomBytes } from 'node:crypto';

/**
 * Mint an opaque, unguessable public-link token (ADR 0028): 256 bits of
 * CSPRNG entropy, base64url-encoded → 43 URL-safe characters, no padding.
 *
 * The token is stored verbatim in `PublicLink.token`; the database row is the
 * authority, so the token carries no signature and needs no secret.
 */
export const generatePublicToken = (): string => randomBytes(32).toString('base64url');
