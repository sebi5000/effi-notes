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
      loading: 'Loading…',
      collapseSidebar: 'Collapse sidebar',
    },
    folderActions: {
      newFolder: 'New folder',
      newFolderPlaceholder: 'Folder name',
      rename: 'Rename folder',
      delete: 'Delete folder',
    },
    noteActions: {
      newNote: 'New note',
      renameNote: 'Rename note',
      duplicateNote: 'Duplicate note',
      renameNotePlaceholder: 'Note title',
    },
    commandBar: {
      label: 'Search',
      placeholder: 'Search…',
      hint: 'Type # for tags, / for folders',
      noTagMatch: 'No tags match.',
      noFolderMatch: 'No folders match.',
      clearSearch: 'Clear search',
    },
    share: {
      sharedIndicatorLabel: 'Shared — click to manage',
      title: 'Share',
      currentAccess: 'Current access',
      addPeople: 'Add people',
      noShares: 'Not shared with anyone yet.',
      revoke: 'Revoke',
      add: 'Add',
      close: 'Close',
      forever: 'No expiry',
      expiresAt: 'Expires',
      error: 'Error',
      loading: 'Loading…',
      userSearch: 'Search people…',
      access: 'Access level',
      view: 'View',
      edit: 'Edit',
      expiryForever: 'No expiry',
      expiryValue: 'Expiry duration',
      expiryUnit: 'Expiry unit',
    },
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
    shareCount: 0,
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
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
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
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
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
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
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
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
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
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
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

describe('Sidebar — collapse control', () => {
  it('shows no collapse button when onCollapse is omitted', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(within(container).queryByLabelText('Collapse sidebar')).toBeNull();
  });

  it('renders a collapse button that calls onCollapse', () => {
    const onCollapse = vi.fn();
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
          onCollapse={onCollapse}
        />,
      ),
    );
    fireEvent.click(within(container).getByLabelText('Collapse sidebar'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar — notes list', () => {
  it('shows the loading row while pending and the list is empty', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          pending
          selectedFolderId={null}
          selectedNoteId={null}
          query="/Clients"
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(within(container).getByText('Loading…')).toBeTruthy();
  });

  it('lists notes once loaded', () => {
    const loaded: NoteListItem[] = [
      {
        id: 'n1',
        title: 'First note',
        folderId: null,
        authorId: 'u1',
        archivedAt: null,
        updatedAt: '2026-05-14T00:00:00.000Z',
        tags: [],
        shareCount: 0,
      },
    ];
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={loaded}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(within(container).getByText('First note')).toBeTruthy();
  });
});

describe('Sidebar — share indicator on note rows', () => {
  const sharedNote: NoteListItem = {
    id: 'shared-note',
    title: 'Shared note',
    folderId: null,
    authorId: 'u1',
    archivedAt: null,
    updatedAt: '2026-05-14T00:00:00.000Z',
    tags: [],
    shareCount: 2,
  };

  const unsharedNote: NoteListItem = {
    id: 'plain-note',
    title: 'Plain note',
    folderId: null,
    authorId: 'u1',
    archivedAt: null,
    updatedAt: '2026-05-14T00:00:00.000Z',
    tags: [],
    shareCount: 0,
  };

  it('renders an eye button for a note with shareCount > 0', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={[sharedNote]}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(
      within(container).getByRole('button', { name: 'Shared — click to manage' }),
    ).toBeTruthy();
  });

  it('does not render an eye button for a note with shareCount === 0', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={[unsharedNote]}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(
      within(container).queryByRole('button', { name: 'Shared — click to manage' }),
    ).toBeNull();
  });

  it('clicking the eye button on a note row opens the share dialog for that note', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={[sharedNote]}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    fireEvent.click(within(container).getByRole('button', { name: 'Shared — click to manage' }));
    // ShareDialog should be open — it has role="dialog"
    expect(within(container).getByRole('dialog')).toBeTruthy();
  });
});

describe('Sidebar — note mutations', () => {
  it('clicking the new-note "+" button calls noteMutations.onCreate', async () => {
    const onCreate = vi.fn(async () => undefined);
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
          noteMutations={{
            onCreate,
            onRename: vi.fn(async () => undefined),
            onDuplicate: vi.fn(async () => undefined),
          }}
        />,
      ),
    );
    fireEvent.click(within(container).getByLabelText('New note'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });

  const noteWithMutations: NoteListItem = {
    id: 'note-mutations-target',
    title: 'Target note',
    folderId: null,
    authorId: 'u1',
    archivedAt: null,
    updatedAt: '2026-05-14T00:00:00.000Z',
    tags: [],
    shareCount: 0,
  };

  it('activating the rename control shows an input and Enter commits the new title', async () => {
    const onRename = vi.fn(async () => undefined);
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={[noteWithMutations]}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
          noteMutations={{
            onCreate: vi.fn(async () => undefined),
            onRename,
            onDuplicate: vi.fn(async () => undefined),
          }}
        />,
      ),
    );

    fireEvent.click(within(container).getByLabelText('Rename note'));
    const input = within(container).getByLabelText('Rename note') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith('note-mutations-target', 'Renamed title'),
    );
  });

  it('activating the duplicate control calls noteMutations.onDuplicate with the note id', async () => {
    const onDuplicate = vi.fn(async () => undefined);
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={[noteWithMutations]}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
          noteMutations={{
            onCreate: vi.fn(async () => undefined),
            onRename: vi.fn(async () => undefined),
            onDuplicate,
          }}
        />,
      ),
    );

    fireEvent.click(within(container).getByLabelText('Duplicate note'));

    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith('note-mutations-target'));
  });
});
