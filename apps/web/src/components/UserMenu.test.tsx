// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./user-menu-actions.ts', () => ({
  signOutAction: vi.fn(async () => undefined),
}));

import { UserMenu } from './UserMenu.tsx';

afterEach(cleanup);

const messages = {
  userMenu: {
    menuLabel: 'Account menu',
    settings: 'Settings',
    signOut: 'Sign out',
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages as Record<string, unknown>}>
    {ui}
  </NextIntlClientProvider>
);

describe('UserMenu', () => {
  it('renders a trigger with avatar initials from the displayName', () => {
    const { getByRole } = render(
      wrap(<UserMenu user={{ displayName: 'Alice Anon', email: 'alice@example.com' }} />),
    );
    expect(getByRole('button', { name: 'Account menu' }).textContent).toBe('AA');
  });

  it('falls back to email initials when displayName is null', () => {
    const { getByRole } = render(
      wrap(<UserMenu user={{ displayName: null, email: 'bob@example.com' }} />),
    );
    expect(getByRole('button', { name: 'Account menu' }).textContent).toBe('BO');
  });

  it('opens the menu on click and reveals settings + sign-out', () => {
    const { getByRole, getByText } = render(
      wrap(<UserMenu user={{ displayName: 'Alice', email: 'alice@example.com' }} />),
    );
    fireEvent.click(getByRole('button', { name: 'Account menu' }));
    expect(getByRole('menu')).toBeTruthy();
    expect(getByText('Settings').getAttribute('href')).toBe('/settings');
    expect(getByText('Sign out')).toBeTruthy();
  });

  it('closes the menu on Escape', () => {
    const { getByRole, queryByRole } = render(
      wrap(<UserMenu user={{ displayName: 'Alice', email: 'alice@example.com' }} />),
    );
    fireEvent.click(getByRole('button', { name: 'Account menu' }));
    expect(queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByRole('menu')).toBeNull();
  });

  it('closes the menu on outside click', () => {
    const { getByRole, queryByRole } = render(
      wrap(
        <div>
          <UserMenu user={{ displayName: 'Alice', email: 'alice@example.com' }} />
          <div data-testid="outside">outside</div>
        </div>,
      ),
    );
    fireEvent.click(getByRole('button', { name: 'Account menu' }));
    fireEvent.mouseDown(document.body);
    expect(queryByRole('menu')).toBeNull();
  });
});
