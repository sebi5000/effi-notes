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
      expirySet: 'Set an expiry',
      expiryHeading: 'Expires',
      expiryValue: 'Duration value',
      expiryUnit: 'Duration unit',
      unitMinutes: 'minutes',
      unitHours: 'hours',
      unitDays: 'days',
      publicLinkHeading: 'Public link',
      publicLinkDescription: 'Anyone with this link can view this note without an account.',
      publicLinkGenerate: 'Generate public link',
      publicLinkCopy: 'Copy',
      publicLinkCopied: 'Copied',
      publicLinkRevoke: 'Revoke link',
      publicLinkSaveExpiry: 'Save expiry',
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
    if (method === 'PATCH') {
      const body = JSON.parse((init?.body as string) ?? '{}') as { ttl: unknown };
      const expiresAt = body.ttl === null ? null : new Date(Date.now() + 60_000).toISOString();
      return json({ ...LINK, expiresAt });
    }
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

  it('sends the picked TTL to the API and shows the date after generation', async () => {
    // POST returns a link with a real expiresAt — simulates the backend
    // honouring the TTL.
    const expiresIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (method === 'POST') {
        return json(
          {
            id: 'pl-1',
            token: 'tok',
            url: '/p/tok',
            expiresAt: expiresIso,
            createdAt: '2026-01-01T00:00:00Z',
          },
          201,
        );
      }
      return json({ link: null });
    }) as unknown as typeof fetch;

    render(wrap(<PublicLinkSection noteId="note-1" fetcher={fetcher} />));
    // Toggle the public-link section's expiry picker on.
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Set an expiry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate public link' }));

    await waitFor(() => expect(methodsOf(fetcher)).toContain('POST'));
    const calls = (fetcher as unknown as FetchMock).mock.calls;
    const postCall = calls.find(([, init]) => init?.method?.toUpperCase() === 'POST');
    expect(postCall).toBeDefined();
    if (!postCall) return;
    const init = postCall[1];
    expect(init?.body).toBeDefined();
    const body = JSON.parse(init?.body as string) as {
      ttl?: { value: number; unit: string };
    };
    expect(body.ttl).toEqual({ value: 7, unit: 'days' });

    // The label after generation should show the date, not "No expiry".
    await waitFor(() =>
      expect(screen.queryByText((text) => text.startsWith('Expires:'))).not.toBeNull(),
    );
    expect(screen.queryByText('No expiry')).toBeNull();
  });

  it('updates the expiry of an existing link via PATCH (token preserved)', async () => {
    const fetcher = buildFetcher(LINK);
    render(wrap(<PublicLinkSection noteId="note-1" fetcher={fetcher} />));
    // Wait for the link-exists branch (Revoke button is only in that branch)
    // so we click the picker that targets `updateExpiry`, not the stale one
    // from the loading-state branch.
    await screen.findByRole('button', { name: 'Revoke link' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set an expiry' }));
    // Wait for the duration inputs to appear so React's re-render captures
    // the new ttl in the Save button's onClick closure.
    await screen.findByRole('spinbutton');
    fireEvent.click(screen.getByRole('button', { name: 'Save expiry' }));

    await waitFor(() => expect(methodsOf(fetcher)).toContain('PATCH'));
    const calls = (fetcher as unknown as FetchMock).mock.calls;
    const patchCall = calls.find(([, init]) => init?.method?.toUpperCase() === 'PATCH');
    expect(patchCall).toBeDefined();
    if (!patchCall) return;
    const init = patchCall[1];
    expect(init?.body).toBeDefined();
    const body = JSON.parse(init?.body as string) as { ttl: unknown };
    expect(body.ttl).toEqual({ value: 7, unit: 'days' });
    // Label flips off "No expiry" once the PATCH response lands.
    await waitFor(() => expect(screen.queryByText('No expiry')).toBeNull());
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
