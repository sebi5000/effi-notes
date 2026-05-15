// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { Sidebar } from './index.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    sidebar: {
      foldersHeading: 'Folders',
      tagsHeading: 'Tags',
      notesHeading: 'Notes',
      emptyState: 'No notes here yet.',
    },
    folderActions: {
      newFolder: 'New folder',
      newFolderPlaceholder: 'Folder name',
      rename: 'Rename folder',
      delete: 'Delete folder',
    },
    commandBar: { label: 'Search', placeholder: 'Search…' },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const folders: FolderNode[] = [
  {
    id: 'clients',
    name: 'Clients',
    parentId: null,
    position: 0,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  },
];
const tags: TagItem[] = [];
const notes: NoteListItem[] = [];

describe('Sidebar — folder mutations', () => {
  it('shows a "New folder" button only when mutations are supplied', () => {
    const { container, rerender } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedTagId={null}
          selectedNoteId={null}
          onSelectFolder={() => undefined}
          onSelectTag={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(within(container).queryByLabelText('New folder')).toBeNull();

    rerender(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedTagId={null}
          selectedNoteId={null}
          onSelectFolder={() => undefined}
          onSelectTag={() => undefined}
          onSelectNote={() => undefined}
          folderMutations={{
            onCreate: vi.fn(async () => undefined),
            onRename: vi.fn(async () => undefined),
            onDelete: vi.fn(async () => undefined),
          }}
        />,
      ),
    );
    expect(within(container).getAllByLabelText('New folder').length).toBeGreaterThan(0);
  });

  it('clicking + opens an inline input and Enter calls onCreate with selected parent', async () => {
    const onCreate = vi.fn(async () => undefined);
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId="clients"
          selectedTagId={null}
          selectedNoteId={null}
          onSelectFolder={() => undefined}
          onSelectTag={() => undefined}
          onSelectNote={() => undefined}
          folderMutations={{
            onCreate,
            onRename: vi.fn(async () => undefined),
            onDelete: vi.fn(async () => undefined),
          }}
        />,
      ),
    );

    // First "New folder" element is the button, second is the input label.
    fireEvent.click(within(container).getAllByLabelText('New folder')[0] as HTMLElement);
    const input = within(container).getAllByLabelText('New folder').at(-1) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Acme', 'clients'));
  });

  it('Escape during create cancels without calling onCreate', () => {
    const onCreate = vi.fn(async () => undefined);
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedTagId={null}
          selectedNoteId={null}
          onSelectFolder={() => undefined}
          onSelectTag={() => undefined}
          onSelectNote={() => undefined}
          folderMutations={{
            onCreate,
            onRename: vi.fn(async () => undefined),
            onDelete: vi.fn(async () => undefined),
          }}
        />,
      ),
    );
    fireEvent.click(within(container).getAllByLabelText('New folder')[0] as HTMLElement);
    const input = within(container).getAllByLabelText('New folder').at(-1) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('surfaces create errors as an alert', async () => {
    const onCreate = vi.fn(async () => {
      throw new Error('parent folder not found');
    });
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedTagId={null}
          selectedNoteId={null}
          onSelectFolder={() => undefined}
          onSelectTag={() => undefined}
          onSelectNote={() => undefined}
          folderMutations={{
            onCreate,
            onRename: vi.fn(async () => undefined),
            onDelete: vi.fn(async () => undefined),
          }}
        />,
      ),
    );
    fireEvent.click(within(container).getAllByLabelText('New folder')[0] as HTMLElement);
    const input = within(container).getAllByLabelText('New folder').at(-1) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(within(container).getByRole('alert').textContent).toContain('parent folder not found'),
    );
  });
});
