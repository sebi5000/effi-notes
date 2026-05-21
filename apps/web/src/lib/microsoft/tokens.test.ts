import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupNotesDomain, makeTestUser } from '@/lib/api/test-session.ts';
import { isMicrosoftConfigured } from './oauth.ts';
import { getMicrosoftAccessToken } from './tokens.ts';

/**
 * Token tests intentionally inject a fake `fetcher` so they don't reach
 * Microsoft's token endpoint. The fetch wrapper is the only impure surface
 * — the persistence behaviour around rotated/revoked refresh tokens is
 * what we want to lock down.
 */

beforeEach(async () => {
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('getMicrosoftAccessToken', () => {
  it('returns not-configured when env vars are absent', async () => {
    // Only meaningful when the env is bare. Otherwise the route under test
    // would short-circuit to the disconnected branch instead, which is
    // covered separately.
    if (isMicrosoftConfigured()) return;
    const { user } = await makeTestUser();
    const r = await getMicrosoftAccessToken(user.id, vi.fn() as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, reason: 'not-configured' });
  });

  it.skipIf(!isMicrosoftConfigured())('returns not-connected when no row exists', async () => {
    const { user } = await makeTestUser();
    const r = await getMicrosoftAccessToken(user.id, vi.fn() as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, reason: 'not-connected' });
  });

  it.skipIf(!isMicrosoftConfigured())(
    'returns a fresh access token without rotating when Microsoft omits refresh_token',
    async () => {
      const { user } = await makeTestUser();
      await prisma.microsoftAccount.create({
        data: {
          userId: user.id,
          tenantId: 't',
          oid: 'o',
          refreshToken: 'rt-original',
          scopes: 'offline_access Calendars.Read',
        },
      });
      const fetcher = vi.fn(async () =>
        json({ access_token: 'at-1', expires_in: 3600, token_type: 'Bearer' }),
      ) as unknown as typeof fetch;
      const r = await getMicrosoftAccessToken(user.id, fetcher);
      expect(r).toEqual({ ok: true, accessToken: 'at-1', expiresInSec: 3600 });

      const reloaded = await prisma.microsoftAccount.findUnique({ where: { userId: user.id } });
      // Refresh token unchanged because Microsoft didn't return a new one.
      expect(reloaded?.refreshToken).toBe('rt-original');
    },
  );

  it.skipIf(!isMicrosoftConfigured())(
    'persists a rotated refresh token (silent rotation loss is the #1 cause of "randomly disconnected")',
    async () => {
      const { user } = await makeTestUser();
      await prisma.microsoftAccount.create({
        data: {
          userId: user.id,
          tenantId: 't',
          oid: 'o',
          refreshToken: 'rt-original',
          scopes: 'offline_access Calendars.Read',
        },
      });
      const fetcher = vi.fn(async () =>
        json({
          access_token: 'at-2',
          expires_in: 3600,
          refresh_token: 'rt-rotated',
          token_type: 'Bearer',
        }),
      ) as unknown as typeof fetch;
      const r = await getMicrosoftAccessToken(user.id, fetcher);
      expect(r.ok).toBe(true);
      const reloaded = await prisma.microsoftAccount.findUnique({ where: { userId: user.id } });
      expect(reloaded?.refreshToken).toBe('rt-rotated');
    },
  );

  it.skipIf(!isMicrosoftConfigured())(
    'deletes the row on 4xx refresh failure so the UI can prompt a reconnect',
    async () => {
      const { user } = await makeTestUser();
      await prisma.microsoftAccount.create({
        data: {
          userId: user.id,
          tenantId: 't',
          oid: 'o',
          refreshToken: 'rt-revoked',
          scopes: 'offline_access Calendars.Read',
        },
      });
      const fetcher = vi.fn(async () =>
        json({ error: 'invalid_grant', error_description: 'AADSTS70008' }, 400),
      ) as unknown as typeof fetch;
      const r = await getMicrosoftAccessToken(user.id, fetcher);
      expect(r).toEqual({ ok: false, reason: 'refresh-failed' });
      const reloaded = await prisma.microsoftAccount.findUnique({ where: { userId: user.id } });
      expect(reloaded).toBeNull();
    },
  );

  it.skipIf(!isMicrosoftConfigured())(
    'returns refresh-failed without deleting the row on 5xx (transient)',
    async () => {
      const { user } = await makeTestUser();
      await prisma.microsoftAccount.create({
        data: {
          userId: user.id,
          tenantId: 't',
          oid: 'o',
          refreshToken: 'rt-still-good',
          scopes: 'offline_access Calendars.Read',
        },
      });
      const fetcher = vi.fn(async () =>
        json({ error: 'temporarily_unavailable' }, 503),
      ) as unknown as typeof fetch;
      const r = await getMicrosoftAccessToken(user.id, fetcher);
      expect(r).toEqual({ ok: false, reason: 'refresh-failed' });
      const reloaded = await prisma.microsoftAccount.findUnique({ where: { userId: user.id } });
      expect(reloaded?.refreshToken).toBe('rt-still-good');
    },
  );
});
