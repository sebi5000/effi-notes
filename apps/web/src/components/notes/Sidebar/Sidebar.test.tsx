// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { NOTE_DND_MIME } from '@/lib/notes/dnd.ts';
import { Sidebar } from './index.tsx';

/**
 * jsdom has no DragEvent and drops a `dataTransfer` init prop, so build the
 * event explicitly and pin `dataTransfer` on before dispatching.
 */
const fireDrag = (
  type: 'dragOver' | 'drop' | 'dragStart',
  el: Element,
  dataTransfer: DataTransfer,
) => {
  const ev = createEvent[type](el);
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
  fireEvent(el, ev);
};

/** Minimal DataTransfer stand-in — jsdom doesn't implement the real one. */
const makeDataTransfer = (): DataTransfer => {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none',
  } as unknown as DataTransfer;
};

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
      shareFolderLabel: 'Share folder',
      shareNoteLabel: 'Share note',
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
        snippet: '',
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

describe('Sidebar — share control on note rows', () => {
  const sharedNote: NoteListItem = {
    id: 'shared-note',
    title: 'Shared note',
    snippet: '',
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
    snippet: '',
    folderId: null,
    authorId: 'u1',
    archivedAt: null,
    updatedAt: '2026-05-14T00:00:00.000Z',
    tags: [],
    shareCount: 0,
  };

  it('renders a share button on an already-shared note row', () => {
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
    expect(within(container).getByRole('button', { name: 'Share note' })).toBeTruthy();
  });

  it('renders the share button for a note that has never been shared (shareCount === 0)', () => {
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
    expect(within(container).getByRole('button', { name: 'Share note' })).toBeTruthy();
  });

  it('clicking the share button on an unshared note row opens the share dialog', () => {
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
    fireEvent.click(within(container).getByRole('button', { name: 'Share note' }));
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
            onMove: vi.fn(async () => undefined),
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
    snippet: '',
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
            onMove: vi.fn(async () => undefined),
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
            onMove: vi.fn(async () => undefined),
          }}
        />,
      ),
    );

    fireEvent.click(within(container).getByLabelText('Duplicate note'));

    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith('note-mutations-target'));
  });

  it('note rows are draggable when noteMutations is provided and dragStart sets NOTE_DND_MIME', () => {
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
            onDuplicate: vi.fn(async () => undefined),
            onMove: vi.fn(async () => undefined),
          }}
        />,
      ),
    );

    const li = within(container).getByText('Target note').closest('li');
    expect(li).not.toBeNull();
    expect(li?.getAttribute('draggable')).toBe('true');

    const dt = makeDataTransfer();
    fireDrag('dragStart', li as Element, dt);

    expect(dt.getData(NOTE_DND_MIME)).toBe('note-mutations-target');
  });

  it('note rows are NOT draggable when noteMutations is omitted', () => {
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
        />,
      ),
    );

    const li = within(container).getByText('Target note').closest('li');
    expect(li).not.toBeNull();
    // draggable should be false or absent when read-only
    expect(li?.getAttribute('draggable')).not.toBe('true');
  });
});

describe('Sidebar — note row card layout', () => {
  const cardNote: NoteListItem = {
    id: 'card-note',
    title: 'My Card Note',
    snippet: 'a preview of the body text',
    folderId: null,
    authorId: 'u1',
    archivedAt: null,
    updatedAt: '2026-05-14T10:00:00.000Z',
    tags: [{ id: 'tag-1', name: 'visible-tag', color: null }],
    shareCount: 0,
  };

  it('renders the note title and snippet, but not tag chips', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={[cardNote]}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );

    // Title must appear
    expect(within(container).getByText('My Card Note')).toBeTruthy();

    // Snippet must appear
    expect(within(container).getByText('a preview of the body text')).toBeTruthy();

    // Tag chip must NOT appear (chips render as #<name>)
    expect(within(container).queryByText('#visible-tag')).toBeNull();
  });
});

describe('Sidebar — two-pane layout', () => {
  it('renders a separate folder section and notes section as siblings', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );

    const folderSection = within(container).getByRole('region', { name: 'Folders' });
    const notesSection = within(container).getByRole('region', { name: 'Notes' });

    // Both sections must exist.
    expect(folderSection).toBeTruthy();
    expect(notesSection).toBeTruthy();

    // The FolderTree (role="tree") must be inside the folder section.
    expect(within(folderSection).getByRole('tree')).toBeTruthy();

    // The notes list must be inside the notes section.
    expect(within(notesSection).getByRole('list')).toBeTruthy();

    // Neither section contains the other.
    expect(folderSection.contains(notesSection)).toBe(false);
    expect(notesSection.contains(folderSection)).toBe(false);
  });
});
