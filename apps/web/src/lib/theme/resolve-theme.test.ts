import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn() };
const authMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
}));

vi.mock('@/auth', () => ({
  auth: () => authMock(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

vi.mock('@app/db', () => ({
  prisma: { user: { findUnique: () => findUniqueMock() } },
}));

import { resolveTheme } from './resolve-theme.ts';

beforeEach(() => {
  cookieStore.get.mockReset();
  authMock.mockReset();
  findUniqueMock.mockReset();
});

describe('resolveTheme', () => {
  it('returns the cookie value when present', async () => {
    cookieStore.get.mockReturnValue({ value: 'dark' });
    expect(await resolveTheme()).toBe('dark');
    expect(authMock).not.toHaveBeenCalled();
  });

  it('falls back to the DB row when the cookie is absent', async () => {
    cookieStore.get.mockReturnValue(undefined);
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    findUniqueMock.mockResolvedValue({ theme: 'cool-slate' });
    expect(await resolveTheme()).toBe('cool-slate');
  });

  it('returns DEFAULT_THEME when neither cookie nor user is available', async () => {
    cookieStore.get.mockReturnValue(undefined);
    authMock.mockResolvedValue(null);
    expect(await resolveTheme()).toBe('warm-paper');
  });

  it('treats an unknown cookie value as absent and falls back', async () => {
    cookieStore.get.mockReturnValue({ value: 'not-a-theme' });
    authMock.mockResolvedValue(null);
    expect(await resolveTheme()).toBe('warm-paper');
  });

  it('treats an unknown DB value as missing and returns DEFAULT_THEME', async () => {
    cookieStore.get.mockReturnValue(undefined);
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    findUniqueMock.mockResolvedValue({ theme: 'stale-id' });
    expect(await resolveTheme()).toBe('warm-paper');
  });

  it('survives auth() throwing', async () => {
    cookieStore.get.mockReturnValue(undefined);
    authMock.mockRejectedValue(new Error('auth down'));
    expect(await resolveTheme()).toBe('warm-paper');
  });
});
