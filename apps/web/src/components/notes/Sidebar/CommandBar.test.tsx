// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode, SearchHit, TagItem } from '@/lib/api/schemas.ts';
import { CommandBar } from './CommandBar.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    commandBar: {
      label: 'Search',
      placeholder: 'Search notes…',
      hint: 'Type # for tags, / for folders',
      noTagMatch: 'No tags match.',
      noFolderMatch: 'No folders match.',
      clearSearch: 'Clear search',
    },
  },
} as const;

const tags: TagItem[] = [
  { id: 't1', name: 'discovery', color: '#C26A20' },
  { id: 't2', name: 'pricing', color: null },
  { id: 't3', name: 'discord-sync', color: null },
];

const folders: FolderNode[] = [
  {
    id: 'clients',
    name: 'Clients',
    parentId: null,
    position: 0,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  },
  {
    id: 'acme',
    name: 'Acme',
    parentId: 'clients',
    position: 0,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  },
];

const noHits = async (): Promise<{ hits: SearchHit[]; total: number }> => ({
  hits: [],
  total: 0,
});

/** Test harness — CommandBar is controlled, so a stateful wrapper holds `value`. */
function Controlled(props: {
  initial?: string;
  onChange?: (next: string) => void;
  onSelect?: (id: string) => void;
  search?: (q: string) => Promise<{ hits: SearchHit[]; total: number }>;
  debounceMs?: number;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <CommandBar
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      onSelect={props.onSelect ?? (() => undefined)}
      folders={folders}
      tags={tags}
      search={props.search ?? noHits}
      debounceMs={props.debounceMs ?? 10}
    />
  );
}

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('CommandBar — text-search mode', () => {
  it('renders an accessible search input', () => {
    const { container } = render(wrap(<Controlled />));
    const search = container.querySelector('search');
    expect(search?.querySelector('input')).toBeTruthy();
  });

  it('calls the search fn after the debounce window', async () => {
    const search = vi.fn(noHits);
    const { container } = render(wrap(<Controlled search={search} debounceMs={20} />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'strategy' },
    });
    await waitFor(() => expect(search).toHaveBeenCalledWith('strategy'), { timeout: 200 });
  });

  it('renders the results list and Enter opens the first hit', async () => {
    const onSelect = vi.fn();
    const search = vi.fn(async () => ({
      hits: [{ id: 'n1', title: 'Hit One', snippet: '', folderId: null, updatedAt: '' }],
      total: 1,
    }));
    const { container } = render(wrap(<Controlled onSelect={onSelect} search={search} />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'h' } });
    await waitFor(() => expect(within(container).queryByText('Hit One')).not.toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('n1');
  });
});

describe('CommandBar — tag mode', () => {
  it('shows the tag-suggestion dropdown when input starts with #', () => {
    const { container } = render(wrap(<Controlled />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#dis' },
    });
    const list = within(container).getByLabelText('Tag suggestions');
    expect(list.textContent).toContain('discovery');
    expect(list.textContent).toContain('discord-sync');
  });

  it('does not call the text-search fn while in tag mode', () => {
    const search = vi.fn(noHits);
    const { container } = render(wrap(<Controlled search={search} />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#disc' },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('clicking a tag sets the value to #<name> and closes the dropdown', async () => {
    const { container } = render(wrap(<Controlled />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#pri' } });
    fireEvent.click(within(container).getByText('#pricing'));
    await waitFor(() => expect(input.value).toBe('#pricing'));
    expect(within(container).queryByLabelText('Tag suggestions')).toBeNull();
  });

  it('shows "no tags match" when the needle has no hit', () => {
    const { container } = render(wrap(<Controlled />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#zzz' },
    });
    expect(within(container).getByLabelText('Tag suggestions').textContent).toContain(
      'No tags match',
    );
  });
});

describe('CommandBar — folder mode', () => {
  it('shows the folder-suggestion dropdown when input starts with /', () => {
    const { container } = render(wrap(<Controlled />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '/cli' },
    });
    const list = within(container).getByLabelText('Folder suggestions');
    expect(list.textContent).toContain('/Clients');
    expect(list.textContent).toContain('/Clients/Acme');
  });

  it('clicking a folder sets the value to its full /path', async () => {
    const { container } = render(wrap(<Controlled />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/cli' } });
    fireEvent.click(within(container).getByText('/Clients/Acme'));
    await waitFor(() => expect(input.value).toBe('/Clients/Acme'));
    expect(within(container).queryByLabelText('Folder suggestions')).toBeNull();
  });

  it('Enter applies the first folder match', async () => {
    const { container } = render(wrap(<Controlled />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/cli' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('/Clients'));
  });

  it('does not call the text-search fn while in folder mode', () => {
    const search = vi.fn(noHits);
    const { container } = render(wrap(<Controlled search={search} />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '/cli' },
    });
    expect(search).not.toHaveBeenCalled();
  });
});

describe('CommandBar — clear button', () => {
  it('renders no clear button when the value is empty', () => {
    const { container } = render(wrap(<Controlled />));
    expect(within(container).queryByLabelText('Clear search')).toBeNull();
  });

  it('clicking the clear button empties the value', async () => {
    const { container } = render(wrap(<Controlled initial="#discovery" />));
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('#discovery');
    fireEvent.click(within(container).getByLabelText('Clear search'));
    await waitFor(() => expect(input.value).toBe(''));
  });
});
