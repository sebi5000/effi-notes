// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TagItem } from '@/lib/api/schemas.ts';
import { CommandBar, filterTags, parseCommand } from './CommandBar.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    commandBar: {
      label: 'Search',
      placeholder: 'Search notes…',
      hint: 'Type # to filter by tag',
      noTagMatch: 'No tags match.',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const tags: TagItem[] = [
  { id: 't1', name: 'discovery', color: '#C26A20' },
  { id: 't2', name: 'pricing', color: null },
  { id: 't3', name: 'discord-sync', color: null },
];

describe('parseCommand', () => {
  it('returns empty for whitespace-only input', () => {
    expect(parseCommand('   ')).toEqual({ kind: 'empty' });
    expect(parseCommand('')).toEqual({ kind: 'empty' });
  });

  it('routes # prefix to tag mode (lowercased, # stripped)', () => {
    expect(parseCommand('#Discovery')).toEqual({ kind: 'tag', needle: 'discovery' });
    expect(parseCommand('  #x  ')).toEqual({ kind: 'tag', needle: 'x' });
  });

  it('routes anything else to text mode', () => {
    expect(parseCommand('strategy')).toEqual({ kind: 'text', q: 'strategy' });
  });
});

describe('filterTags', () => {
  it('prefix matches rank above substring matches', () => {
    const out = filterTags(tags, 'dis');
    expect(out.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('returns the unfiltered list for an empty needle', () => {
    expect(filterTags(tags, '').length).toBe(tags.length);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterTags(tags, 'zzz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterTags(tags, 'DISC').length).toBe(2);
  });
});

describe('CommandBar (text-search mode)', () => {
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

describe('CommandBar (tag mode)', () => {
  it('shows the tag-suggestion dropdown when input starts with #', () => {
    const onTagSelect = vi.fn();
    const { container } = render(
      wrap(
        <CommandBar
          onSelect={() => undefined}
          onTagSelect={onTagSelect}
          tags={tags}
          search={async () => ({ hits: [], total: 0 })}
          debounceMs={10}
        />,
      ),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#dis' } });
    const list = within(container).getByLabelText('Tag suggestions');
    expect(list.textContent).toContain('discovery');
    expect(list.textContent).toContain('discord-sync');
  });

  it('does not call the text-search fn while in tag mode', () => {
    const search = vi.fn(async () => ({ hits: [], total: 0 }));
    const { container } = render(
      wrap(
        <CommandBar
          onSelect={() => undefined}
          onTagSelect={() => undefined}
          tags={tags}
          search={search}
          debounceMs={5}
        />,
      ),
    );
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#disc' },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('Enter on tag mode selects the first matching tag', async () => {
    const onTagSelect = vi.fn();
    const { container } = render(
      wrap(
        <CommandBar
          onSelect={() => undefined}
          onTagSelect={onTagSelect}
          tags={tags}
          search={async () => ({ hits: [], total: 0 })}
          debounceMs={10}
        />,
      ),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#dis' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onTagSelect).toHaveBeenCalledWith('t1'));
  });

  it('clicking a tag in the dropdown applies the filter and clears the input', async () => {
    const onTagSelect = vi.fn();
    const { container } = render(
      wrap(
        <CommandBar
          onSelect={() => undefined}
          onTagSelect={onTagSelect}
          tags={tags}
          search={async () => ({ hits: [], total: 0 })}
          debounceMs={10}
        />,
      ),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#pri' } });
    fireEvent.click(within(container).getByText('#pricing'));
    expect(onTagSelect).toHaveBeenCalledWith('t2');
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('shows "no tags match" when the needle has no hit', () => {
    const { container } = render(
      wrap(
        <CommandBar
          onSelect={() => undefined}
          onTagSelect={() => undefined}
          tags={tags}
          search={async () => ({ hits: [], total: 0 })}
          debounceMs={10}
        />,
      ),
    );
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#zzz' },
    });
    expect(within(container).getByLabelText('Tag suggestions').textContent).toContain(
      'No tags match',
    );
  });
});
