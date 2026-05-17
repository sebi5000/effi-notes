// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TagItem } from '@/lib/api/schemas.ts';
import { TagBar } from './TagBar.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    tagBar: {
      addTag: 'Tag',
      removeTag: 'Remove tag {name}',
      createTag: 'Create "{name}"',
      placeholder: 'Tag name…',
      noMatches: 'No tags found',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const makeTag = (id: string, name: string, color: string | null = null): TagItem => ({
  id,
  name,
  color,
});

const ALL_TAGS: TagItem[] = [
  makeTag('t1', 'discovery'),
  makeTag('t2', 'research'),
  makeTag('t3', 'design'),
];

describe('TagBar', () => {
  it('renders a chip for each tag in tags', () => {
    const tags = [makeTag('t1', 'discovery'), makeTag('t2', 'research')];
    const onChange = vi.fn().mockResolvedValue(undefined);
    const onCreateTag = vi.fn().mockResolvedValue(makeTag('new-id', 'whatever'));

    const { container } = render(
      wrap(<TagBar tags={tags} allTags={ALL_TAGS} onChange={onChange} onCreateTag={onCreateTag} />),
    );

    expect(within(container).getByText('#discovery')).not.toBeNull();
    expect(within(container).getByText('#research')).not.toBeNull();
  });

  it('clicking the remove button calls onChange without that tag id', async () => {
    const tags = [makeTag('t1', 'discovery'), makeTag('t2', 'research')];
    const onChange = vi.fn().mockResolvedValue(undefined);
    const onCreateTag = vi.fn().mockResolvedValue(makeTag('new-id', 'whatever'));

    const { container } = render(
      wrap(<TagBar tags={tags} allTags={ALL_TAGS} onChange={onChange} onCreateTag={onCreateTag} />),
    );

    const removeBtn = within(container).getByLabelText('Remove tag discovery');
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(['t2']);
    });
  });

  it('clicking the "+ Tag" button reveals a text input', () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const onCreateTag = vi.fn().mockResolvedValue(makeTag('new-id', 'whatever'));

    const { container } = render(
      wrap(<TagBar tags={[]} allTags={ALL_TAGS} onChange={onChange} onCreateTag={onCreateTag} />),
    );

    const addBtn = within(container).getByText(/\+ Tag/);
    fireEvent.click(addBtn);

    expect(within(container).getByLabelText('Tag')).not.toBeNull();
  });

  it('typing matching text shows existing tag in dropdown; clicking it calls onChange with added id', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const onCreateTag = vi.fn().mockResolvedValue(makeTag('new-id', 'whatever'));

    const { container } = render(
      wrap(<TagBar tags={[]} allTags={ALL_TAGS} onChange={onChange} onCreateTag={onCreateTag} />),
    );

    fireEvent.click(within(container).getByText(/\+ Tag/));

    const input = within(container).getByLabelText('Tag');
    fireEvent.change(input, { target: { value: 'disc' } });

    await waitFor(() => {
      expect(within(container).getByText('#discovery')).not.toBeNull();
    });

    const discoveryBtn = within(container).getByText('#discovery');
    // Use mouseDown + click to match the onMouseDown preventDefault + onClick pattern
    fireEvent.mouseDown(discoveryBtn);
    fireEvent.click(discoveryBtn);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(['t1']);
    });
  });

  it('typing a name that matches no tag shows a "Create …" row; clicking it calls onCreateTag then onChange', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const newTag = makeTag('new-id', 'brandnew');
    const onCreateTag = vi.fn().mockResolvedValue(newTag);

    const { container } = render(
      wrap(<TagBar tags={[]} allTags={ALL_TAGS} onChange={onChange} onCreateTag={onCreateTag} />),
    );

    fireEvent.click(within(container).getByText(/\+ Tag/));

    const input = within(container).getByLabelText('Tag');
    fireEvent.change(input, { target: { value: 'brandnew' } });

    await waitFor(() => {
      expect(within(container).getByText(/Create "brandnew"/)).not.toBeNull();
    });

    const createBtn = within(container).getByText(/Create "brandnew"/);
    fireEvent.mouseDown(createBtn);
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(onCreateTag).toHaveBeenCalledWith('brandnew');
      expect(onChange).toHaveBeenCalledWith(['new-id']);
    });
  });

  it('when onChange rejects, an inline alert error appears', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('update failed'));
    const onCreateTag = vi.fn().mockResolvedValue(makeTag('new-id', 'whatever'));
    const tags = [makeTag('t1', 'discovery')];

    const { container } = render(
      wrap(<TagBar tags={tags} allTags={ALL_TAGS} onChange={onChange} onCreateTag={onCreateTag} />),
    );

    const removeBtn = within(container).getByLabelText('Remove tag discovery');
    fireEvent.click(removeBtn);

    await waitFor(() => {
      const alert = within(container).getByRole('alert');
      expect(alert.textContent).toBe('update failed');
    });
  });
});
