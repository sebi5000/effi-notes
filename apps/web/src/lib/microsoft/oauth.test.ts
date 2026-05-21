import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  codeExchangeBody,
  decodeIdTokenClaims,
  isMicrosoftConfigured,
  refreshExchangeBody,
  signState,
  verifyState,
} from './oauth.ts';

/**
 * The env vars are wired in the test-env file
 * (`apps/web/vitest.setup.ts`-style). When this suite runs without them,
 * `isMicrosoftConfigured()` returns false and the pure helpers throw on
 * use — `signState`/`verifyState` work either way since they only need
 * AUTH_SECRET.
 */

describe('microsoft/oauth — state signing', () => {
  it('round-trips a userId through sign/verify', () => {
    const state = signState('user-123');
    const v = verifyState(state);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.userId).toBe('user-123');
  });

  it('produces a different state for the same userId across calls (nonce)', () => {
    expect(signState('u')).not.toBe(signState('u'));
  });

  it('rejects a tampered userId', () => {
    const state = signState('alice');
    // Swap the userId segment for a different (still-valid base64url) value;
    // signature won't match.
    const [, nonceB64, sigB64] = state.split('.');
    const evil = `${Buffer.from('mallory', 'utf8').toString('base64url')}.${nonceB64}.${sigB64}`;
    const v = verifyState(evil);
    expect(v.ok).toBe(false);
  });

  it('rejects a malformed state (wrong segment count)', () => {
    const v = verifyState('not.a.valid.state');
    expect(v).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a tampered signature of the right length', () => {
    const state = signState('alice');
    const [userIdB64, nonceB64, sigB64] = state.split('.');
    // Flip one byte of the signature.
    const sigBuf = Buffer.from(sigB64 ?? '', 'base64url');
    sigBuf[0] = (sigBuf[0] ?? 0) ^ 0xff;
    const evil = `${userIdB64}.${nonceB64}.${sigBuf.toString('base64url')}`;
    expect(verifyState(evil)).toEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('microsoft/oauth — id_token decoding', () => {
  it('reads tid/oid/preferred_username from a JWT payload', () => {
    const claims = {
      tid: 'tenant-abc',
      oid: 'object-xyz',
      preferred_username: 'alice@contoso.com',
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const fakeJwt = `header.${payload}.sig`;
    const parsed = decodeIdTokenClaims(fakeJwt);
    expect(parsed).toEqual(claims);
  });

  it('returns null on an unparseable JWT', () => {
    expect(decodeIdTokenClaims('not-a-jwt')).toBeNull();
    expect(decodeIdTokenClaims('header.not-base64.sig')).toBeNull();
  });

  it('returns null when required claims (tid/oid) are missing', () => {
    const payload = Buffer.from(JSON.stringify({ preferred_username: 'x' }), 'utf8').toString(
      'base64url',
    );
    expect(decodeIdTokenClaims(`a.${payload}.c`)).toBeNull();
  });
});

describe('microsoft/oauth — request body / URL builders (require env)', () => {
  // These tests only run meaningfully when MICROSOFT_* env vars are set.
  // They're a smoke check on the URL shape so the integration tests don't
  // have to learn the OAuth wire format.
  it.skipIf(!isMicrosoftConfigured())('buildAuthorizeUrl carries the expected query params', () => {
    const url = new URL(buildAuthorizeUrl('s'));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('offline_access Calendars.Read');
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it.skipIf(!isMicrosoftConfigured())(
    'codeExchangeBody carries grant_type=authorization_code',
    () => {
      const body = codeExchangeBody('abc');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('abc');
    },
  );

  it.skipIf(!isMicrosoftConfigured())(
    'refreshExchangeBody carries grant_type=refresh_token',
    () => {
      const body = refreshExchangeBody('rt');
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('rt');
    },
  );
});
