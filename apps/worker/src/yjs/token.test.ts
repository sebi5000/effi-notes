import { describe, expect, it } from 'vitest';
import { issueToken, verifyToken } from './token.ts';

const SECRET = 'test-secret-at-least-32-chars-long-for-jwt-style-use';

describe('y-websocket token', () => {
  it('round-trips a freshly issued token', () => {
    const token = issueToken({ secret: SECRET, noteId: 'n1', userId: 'u1', access: 'w' });
    const parsed = verifyToken({ secret: SECRET, token });
    expect(parsed).not.toBeNull();
    expect(parsed?.noteId).toBe('n1');
    expect(parsed?.userId).toBe('u1');
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = issueToken({ secret: SECRET, noteId: 'n1', userId: 'u1', access: 'w' });
    const parsed = verifyToken({ secret: 'different-secret', token });
    expect(parsed).toBeNull();
  });

  it('rejects an expired token', () => {
    const past = () => 1_000_000;
    const token = issueToken({
      secret: SECRET,
      noteId: 'n',
      userId: 'u',
      access: 'w',
      ttlSeconds: 1,
      now: past,
    });
    // Verify "now" = 10s after issue → past expiry
    const parsed = verifyToken({ secret: SECRET, token, now: () => 1_010_000 });
    expect(parsed).toBeNull();
  });

  it('rejects a malformed token (wrong number of parts)', () => {
    expect(verifyToken({ secret: SECRET, token: 'a:b:c' })).toBeNull();
    expect(verifyToken({ secret: SECRET, token: '' })).toBeNull();
  });

  it('rejects a token with tampered payload', () => {
    const token = issueToken({ secret: SECRET, noteId: 'n1', userId: 'u1', access: 'w' });
    const tampered = token.replace('n1', 'n2');
    expect(verifyToken({ secret: SECRET, token: tampered })).toBeNull();
  });

  it('rejects a non-integer expiry', () => {
    const parts = issueToken({ secret: SECRET, noteId: 'n', userId: 'u', access: 'w' }).split(':');
    parts[3] = 'NaN';
    expect(verifyToken({ secret: SECRET, token: parts.join(':') })).toBeNull();
  });

  it('refuses to issue tokens with colons in ids', () => {
    expect(() => issueToken({ secret: SECRET, noteId: 'a:b', userId: 'u', access: 'w' })).toThrow();
    expect(() => issueToken({ secret: SECRET, noteId: 'a', userId: 'u:v', access: 'w' })).toThrow();
  });

  it('round-trips the access claim', () => {
    const token = issueToken({ secret: SECRET, noteId: 'n1', userId: 'u1', access: 'r' });
    const parsed = verifyToken({ secret: SECRET, token });
    expect(parsed?.access).toBe('r');
  });

  it('rejects a token whose access segment is not r/w', () => {
    const token = issueToken({ secret: SECRET, noteId: 'n1', userId: 'u1', access: 'w' });
    const tampered = token.replace(':w:', ':x:');
    expect(verifyToken({ secret: SECRET, token: tampered })).toBeNull();
  });
});
