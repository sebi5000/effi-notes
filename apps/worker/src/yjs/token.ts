import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed token for a y-websocket session.
 *
 * Browsers never receive the AUTH_SECRET — they get a token issued by the
 * web app's /api/collab/[id] route after the auth.js session is verified.
 * The worker re-verifies the token before accepting the WebSocket upgrade.
 *
 * Token format (base64url): `${noteId}:${userId}:${access}:${exp}:${sig}`
 *   - `noteId` and `userId` are cuids (≤40 chars, no colons)
 *   - `access` is `r` (view-only) or `w` (editor)
 *   - `exp` is an integer epoch-second
 *   - `sig` is `HMAC-SHA256(secret, "${noteId}:${userId}:${access}:${exp}")` as base64url
 *
 * Lifetime defaults to 60 seconds — long enough to complete the WS upgrade,
 * short enough that a leaked URL can't be replayed.
 */

export type ParsedToken = {
  noteId: string;
  userId: string;
  access: 'r' | 'w';
  exp: number;
};

const DEFAULT_TTL_SECONDS = 60;

const b64u = (buf: Buffer): string =>
  buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const fromB64u = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');

const sign = (secret: string, payload: string): string =>
  b64u(createHmac('sha256', secret).update(payload).digest());

export const issueToken = (input: {
  secret: string;
  noteId: string;
  userId: string;
  access: 'r' | 'w';
  ttlSeconds?: number;
  now?: () => number;
}): string => {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = input.now ?? Date.now;
  const exp = Math.floor(now() / 1000) + ttl;
  if (input.noteId.includes(':') || input.userId.includes(':')) {
    throw new Error('noteId and userId must not contain colons');
  }
  const payload = `${input.noteId}:${input.userId}:${input.access}:${exp}`;
  const sig = sign(input.secret, payload);
  return `${payload}:${sig}`;
};

export const verifyToken = (input: {
  secret: string;
  token: string;
  now?: () => number;
}): ParsedToken | null => {
  const now = input.now ?? Date.now;
  const parts = input.token.split(':');
  if (parts.length !== 5) return null;
  const [noteId, userId, access, expStr, sig] = parts as [string, string, string, string, string];
  if (access !== 'r' && access !== 'w') return null;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return null;
  if (exp * 1000 < now()) return null;

  const payload = `${noteId}:${userId}:${access}:${exp}`;
  const expectedSig = sign(input.secret, payload);
  const a = fromB64u(sig);
  const b = fromB64u(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { noteId, userId, access, exp };
};
