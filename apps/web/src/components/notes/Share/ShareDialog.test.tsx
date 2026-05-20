// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareView, UserSearchHit } from '@/lib/api/schemas.ts';
import { ShareDialog } from './ShareDialog.tsx';

afterEach(cleanup);

// --------------------------------------------------------------------------
// Minimal i18n messages — tests query by role/aria-label, not translated text.
// Task 23 fills the real keys. These stubs silence next-intl warnings only.
// --------------------------------------------------------------------------
const messages = {
  notes: {
    share: {
      title: 'Share',
      close: 'Close',
      currentAccess: 'Current access',
      addPeople: 'Add people',
      userSearch: 'Search users',
      access: 'Access level',
      add: 'Add',
      forever: 'Forever',
      expiresAt: 'Expires',
      revoke: 'Revoke',
      loading: 'Loading…',
      error: 'Error',
      noShares: 'Not shared',
      view: 'VIEW',
      edit: 'EDIT',
      expiryForever: 'Share forever',
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
      expiredHeading: 'Expired',
      expiredBadge: 'Expired',
      expiredOn: 'Expired on {date}',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages as Record<string, unknown>}>
    {ui}
  </NextIntlClientProvider>
);

// --------------------------------------------------------------------------
// Fixture data
// --------------------------------------------------------------------------
const SHARE_1: ShareView = {
  id: 'share-1',
  grantee: { id: 'user-1', displayName: 'Alice Anon', email: 'alice@example.com' },
  access: 'VIEW',
  expiresAt: null,
  status: 'active',
  createdById: 'owner-id',
  createdAt: '2026-01-01T00:00:00Z',
};

const SHARE_2: ShareView = {
  id: 'share-2',
  grantee: { id: 'user-2', displayName: null, email: 'bob@example.com' },
  access: 'EDIT',
  expiresAt: '2026-12-31T23:59:59Z',
  status: 'active',
  createdById: 'owner-id',
  createdAt: '2026-01-01T00:00:00Z',
};

const SHARE_EXPIRED: ShareView = {
  id: 'share-3',
  grantee: { id: 'user-3', displayName: 'Dani Done', email: 'dani@example.com' },
  access: 'VIEW',
  expiresAt: '2025-01-01T00:00:00.000Z',
  status: 'expired',
  createdById: 'owner-id',
  createdAt: '2024-12-01T00:00:00Z',
};

const USER_HIT: UserSearchHit = {
  id: 'user-3',
  displayName: 'Carol Collab',
  email: 'carol@example.com',
};

const SCOPE = { kind: 'note' as const, id: 'note-abc' };

// --------------------------------------------------------------------------
// Stub fetcher builder
// --------------------------------------------------------------------------
function buildFetcher({
  shares = [SHARE_1],
  users = [] as UserSearchHit[],
}: {
  shares?: ShareView[];
  users?: UserSearchHit[];
} = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method?.toUpperCase() ?? 'GET';

    // GET /api/notes/:id/shares → share list
    if (method === 'GET' && url.includes('/shares')) {
      return new Response(JSON.stringify({ shares }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // POST /api/notes/:id/shares → create
    if (method === 'POST' && url.includes('/shares')) {
      const newShare: ShareView = {
        id: 'share-new',
        grantee: USER_HIT,
        access: 'VIEW',
        expiresAt: null,
        status: 'active',
        createdById: 'owner-id',
        createdAt: new Date().toISOString(),
      };
      return new Response(JSON.stringify(newShare), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    // DELETE /api/notes/:id/shares/:shareId → revoke
    if (method === 'DELETE' && url.includes('/shares/')) {
      return new Response(JSON.stringify({ revoked: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // GET /api/users?q=... → user search
    if (method === 'GET' && url.includes('/api/users')) {
      return new Response(JSON.stringify({ users }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // GET /api/notes/:id/public-link → no public link by default
    if (method === 'GET' && url.includes('/public-link')) {
      return new Response(JSON.stringify({ link: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }) as unknown as typeof fetch;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Narrow the fetcher mock to access .mock.calls without unsafe casts. */
type FetchMock = { mock: { calls: Array<[RequestInfo | URL, RequestInit?]> } };
const asMock = (f: typeof fetch): FetchMock => f as unknown as FetchMock;

function urlFrom(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------
describe('ShareDialog', () => {
  it('renders current share grants with grantee name/email, access badge, and "forever" expiry', async () => {
    const fetcher = buildFetcher({ shares: [SHARE_1, SHARE_2] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={false} onClose={vi.fn()} fetcher={fetcher} />),
    );

    // SHARE_1 — displayName present, VIEW, no expiry
    await waitFor(() => expect(screen.queryByText('Alice Anon')).not.toBeNull());
    expect(screen.queryByText('VIEW')).not.toBeNull();
    // Expiry is null → must render some "forever" indicator (we check for the word)
    expect(screen.queryByText('Forever')).not.toBeNull();

    // SHARE_2 — no displayName, fall back to email, EDIT, has expiry
    expect(screen.queryByText('bob@example.com')).not.toBeNull();
    expect(screen.queryByText('EDIT')).not.toBeNull();
  });

  it('groups expired shares under their own heading and still allows revoke', async () => {
    const fetcher = buildFetcher({ shares: [SHARE_1, SHARE_EXPIRED] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={true} onClose={vi.fn()} fetcher={fetcher} />),
    );

    // Active share renders normally.
    await waitFor(() => expect(screen.queryByText('Alice Anon')).not.toBeNull());
    // Expired heading + per-row badge both render "Expired" — at least 2.
    expect(screen.queryAllByText('Expired').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Expired on/)).not.toBeNull();
    // Revoke is still wired for the expired row (clean-up affordance).
    const revoke = screen.getByRole('button', { name: /revoke Dani Done/i });
    expect(revoke).toBeTruthy();
  });

  it('hides the "add people" section and revoke buttons when canManage is false', async () => {
    const fetcher = buildFetcher({ shares: [SHARE_1] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={false} onClose={vi.fn()} fetcher={fetcher} />),
    );

    await waitFor(() => expect(screen.queryByText('Alice Anon')).not.toBeNull());

    // No user search input
    expect(screen.queryByRole('textbox', { name: 'Search users' })).toBeNull();
    // No revoke button
    expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull();
  });

  it('shows the "add people" section when canManage is true', async () => {
    const fetcher = buildFetcher({ shares: [] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={true} onClose={vi.fn()} fetcher={fetcher} />),
    );

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Search users' })).not.toBeNull(),
    );
  });

  it('triggers a POST to the shares endpoint when the Add button is clicked with a picked user', async () => {
    const fetcher = buildFetcher({ shares: [], users: [USER_HIT] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={true} onClose={vi.fn()} fetcher={fetcher} />),
    );

    // Wait for dialog to settle (share list loaded)
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Search users' })).not.toBeNull(),
    );

    // Type in search — debounce is 300ms but we use fake timers pattern via act
    const searchInput = screen.getByRole('textbox', { name: 'Search users' });
    fireEvent.change(searchInput, { target: { value: 'carol' } });

    // Wait for search results to appear (component fires usersApi.search after debounce)
    await waitFor(() => expect(screen.queryByText('Carol Collab')).not.toBeNull());

    // Click the result to select the user
    fireEvent.click(screen.getByText('Carol Collab'));

    // Click the Add button
    const addButton = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(addButton);

    // Expect a POST to the shares endpoint
    await waitFor(() => {
      const { calls } = asMock(fetcher).mock;
      const postCall = calls.find(([, init]) => init?.method?.toUpperCase() === 'POST');
      expect(postCall).not.toBeUndefined();
      if (!postCall) return;
      expect(urlFrom(postCall[0])).toContain('/shares');
      const body = JSON.parse(postCall[1]?.body as string) as { granteeId: string };
      expect(body.granteeId).toBe('user-3');
    });
  });

  it('triggers a DELETE to the share endpoint when a revoke button is clicked', async () => {
    const fetcher = buildFetcher({ shares: [SHARE_1] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={true} onClose={vi.fn()} fetcher={fetcher} />),
    );

    await waitFor(() => expect(screen.queryByText('Alice Anon')).not.toBeNull());

    // Revoke button aria-label includes the grantee's name
    const revokeBtn = screen.getByRole('button', { name: /revoke Alice Anon/i });
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      const { calls } = asMock(fetcher).mock;
      const deleteCall = calls.find(([, init]) => init?.method?.toUpperCase() === 'DELETE');
      expect(deleteCall).not.toBeUndefined();
      if (!deleteCall) return;
      expect(urlFrom(deleteCall[0])).toContain('/shares/share-1');
    });
  });

  it('calls onClose when the close button is clicked', async () => {
    const fetcher = buildFetcher({ shares: [] });
    const onClose = vi.fn();
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={false} onClose={onClose} fetcher={fetcher} />),
    );

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the public-link section for a note when canManage is true', async () => {
    const fetcher = buildFetcher({ shares: [] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={true} onClose={vi.fn()} fetcher={fetcher} />),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Generate public link' })).not.toBeNull(),
    );
  });

  it('hides the public-link section for a folder scope', async () => {
    const fetcher = buildFetcher({ shares: [] });
    render(
      wrap(
        <ShareDialog
          scope={{ kind: 'folder', id: 'folder-x' }}
          canManage={true}
          onClose={vi.fn()}
          fetcher={fetcher}
        />,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Search users' })).not.toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Generate public link' })).toBeNull();
  });

  it('hides the public-link section when canManage is false', async () => {
    const fetcher = buildFetcher({ shares: [SHARE_1] });
    render(
      wrap(<ShareDialog scope={SCOPE} canManage={false} onClose={vi.fn()} fetcher={fetcher} />),
    );
    await waitFor(() => expect(screen.queryByText('Alice Anon')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Generate public link' })).toBeNull();
  });
});
