// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicLinkView } from '@/lib/api/schemas.ts';
import { PublicLinkSection } from './PublicLinkSection.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    share: {
      error: 'Error',
      forever: 'No expiry',
      expiresAt: 'Expires',
      expiryForever: 'No expiry',
      expiryValue: 'Duration value',
      expiryUnit: 'Duration unit',
      publicLinkHeading: 'Public link',
      publicLinkDescription: 'Anyone with this link can view this note without an account.',
      publicLinkGenerate: 'Generate public link',
      publicLinkCopy: 'Copy',
      publicLinkCopied: 'Copied',
      publicLinkRevoke: 'Revoke link',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages as Record<string, unknown>}>
    {ui}
  </NextIntlClientProvider>
);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LINK: PublicLinkView = {
  id: 'pl-1',
  token: 'tok',
  url: '/p/tok',
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const buildFetcher = (initialLink: PublicLinkView | null): typeof fetch =>
  vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method?.toUpperCase() ?? 'GET';
    if (method === 'POST') return json(LINK, 201);
    if (method === 'DELETE') return json({ revoked: true });
    return json({ link: initialLink });
  }) as unknown as typeof fetch;

type FetchMock = { mock: { calls: Array<[RequestInfo | URL, RequestInit?]> } };
const methodsOf = (f: typeof fetch): string[] =>
  (f as unknown as FetchMock).mock.calls.map(([, init]) => init?.method?.toUpperCase() ?? 'GET');

describe('PublicLinkSection', () => {
  it('offers a Generate button when no link exists', async () => {
    render(wrap(<PublicLinkSection noteId="note-1" fetcher={buildFetcher(null)} />));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Generate public link' })).not.toBeNull(),
    );
  });

  it('generating the link POSTs and then shows the URL', async () => {
    const fetcher = buildFetcher(null);
    render(wrap(<PublicLinkSection noteId="note-1" fetcher={fetcher} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate public link' }));

    await waitFor(() => expect(methodsOf(fetcher)).toContain('POST'));
    const field = (await screen.findByLabelText('Public link')) as HTMLInputElement;
    expect(field.value).toContain('/p/tok');
  });

  it('revokes an existing link', async () => {
    const fetcher = buildFetcher(LINK);
    render(wrap(<PublicLinkSection noteId="note-1" fetcher={fetcher} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke link' }));

    await waitFor(() => expect(methodsOf(fetcher)).toContain('DELETE'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Generate public link' })).not.toBeNull(),
    );
  });
});
