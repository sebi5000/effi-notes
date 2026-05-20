// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeCardGrid } from './ThemeCardGrid.tsx';

afterEach(cleanup);

const messages = {
  settings: {
    themeLabel: 'Theme',
    themeWarmPaper: 'Warm Paper',
    themeDark: 'Dark',
    themeCoolSlate: 'Cool Slate',
    themeSaveFailed: 'Could not save your theme.',
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages as Record<string, unknown>}>
    {ui}
  </NextIntlClientProvider>
);

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('ThemeCardGrid', () => {
  it('renders one selectable card per theme; the current one is checked', () => {
    const { getByRole } = render(wrap(<ThemeCardGrid currentTheme="warm-paper" />));
    expect(getByRole('radio', { name: 'Warm Paper' }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false');
    expect(getByRole('radio', { name: 'Cool Slate' }).getAttribute('aria-checked')).toBe('false');
  });

  it('selecting a different theme PUTs to the API and applies it instantly', async () => {
    const fetcher = vi.fn().mockResolvedValue(okJson({ theme: 'dark' })) as unknown as typeof fetch;
    const { getByRole } = render(
      wrap(<ThemeCardGrid currentTheme="warm-paper" fetcher={fetcher} />),
    );
    fireEvent.click(getByRole('radio', { name: 'Dark' }));

    await waitFor(() => {
      expect(getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    const calls = (fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
    const init = calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ theme: 'dark' });
  });

  it('shows an error and does not switch the active theme on a failed PUT', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const { getByRole, findByRole } = render(
      wrap(<ThemeCardGrid currentTheme="warm-paper" fetcher={fetcher} />),
    );
    fireEvent.click(getByRole('radio', { name: 'Dark' }));
    expect((await findByRole('alert')).textContent).toContain('Could not save your theme.');
    expect(getByRole('radio', { name: 'Warm Paper' }).getAttribute('aria-checked')).toBe('true');
  });
});
