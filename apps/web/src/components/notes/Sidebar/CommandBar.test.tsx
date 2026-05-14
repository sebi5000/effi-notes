// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBar } from './CommandBar.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    commandBar: {
      label: 'Search',
      placeholder: 'Search notes…',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('CommandBar', () => {
  it('renders an accessible search input', () => {
    const { container } = render(
      wrap(<CommandBar onSelect={() => undefined} search={async () => ({ hits: [], total: 0 })} />),
    );
    const search = container.querySelector('search');
    expect(search).toBeTruthy();
    expect(search?.querySelector('input')).toBeTruthy();
  });

  it('calls the search fn after the debounce window', async () => {
    const search = vi.fn(async () => ({ hits: [], total: 0 }));
    const { container } = render(
      wrap(<CommandBar onSelect={() => undefined} search={search} debounceMs={20} />),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'strategy' } });
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 200 });
    expect(search).toHaveBeenLastCalledWith('strategy');
  });

  it('renders the results list when the search returns hits', async () => {
    const search = vi.fn(async () => ({
      hits: [{ id: 'n1', title: 'Hit One', snippet: 'snip', folderId: null, updatedAt: '' }],
      total: 1,
    }));
    const { container } = render(
      wrap(<CommandBar onSelect={() => undefined} search={search} debounceMs={10} />),
    );
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'h' },
    });
    await waitFor(() => expect(within(container).queryByText('Hit One')).not.toBeNull());
  });

  it('Enter on a non-empty result list selects the first hit', async () => {
    const onSelect = vi.fn();
    const search = vi.fn(async () => ({
      hits: [{ id: 'n1', title: 'Hit', snippet: '', folderId: null, updatedAt: '' }],
      total: 1,
    }));
    const { container } = render(
      wrap(<CommandBar onSelect={onSelect} search={search} debounceMs={10} />),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'h' } });
    await waitFor(() => expect(within(container).queryByText('Hit')).not.toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('n1');
  });

  it('clears results when the input becomes empty', async () => {
    const search = vi.fn(async () => ({
      hits: [{ id: 'n1', title: 'Hit', snippet: '', folderId: null, updatedAt: '' }],
      total: 1,
    }));
    const { container } = render(
      wrap(<CommandBar onSelect={() => undefined} search={search} debounceMs={10} />),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'h' } });
    await waitFor(() => expect(within(container).queryByText('Hit')).not.toBeNull());
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(within(container).queryByText('Hit')).toBeNull());
  });
});
