// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import { FOLDER_DND_MIME, NOTE_DND_MIME } from '@/lib/notes/dnd.ts';
import { type FolderMutationHandlers, FolderTree } from './FolderTree.tsx';

afterEach(cleanup);

/**
 * jsdom has no DragEvent and drops a `dataTransfer` init prop, so build the
 * event explicitly and pin `dataTransfer` on before dispatching. The
 * drop-zone DnD design needs no pointer coordinates — `dataTransfer` is all
 * that travels.
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

const messages = {
  notes: {
    folderActions: {
      newFolder: 'New folder',
      newFolderPlaceholder: 'Folder name',
      rename: 'Rename folder',
      delete: 'Delete folder',
      expand: 'Expand',
      collapse: 'Collapse',
      nameInputLabel: 'Folder name',
      copyLink: 'Copy link',
      copyLinkCopied: 'Link copied',
      cycle: "A folder can't be moved into one of its own descendants.",
    },
    folderIcons: {
      pickerLabel: 'Change folder icon',
      names: {
        folder: 'Folder',
        'folder-open': 'Open folder',
        briefcase: 'Briefcase',
        house: 'House',
        user: 'Person',
        users: 'People',
        star: 'Star',
        archive: 'Archive',
        inbox: 'Inbox',
        'file-text': 'Document',
        'book-open': 'Book',
        'graduation-cap': 'Education',
        code: 'Code',
        rocket: 'Rocket',
        lightbulb: 'Idea',
        calendar: 'Calendar',
        'list-checks': 'Checklist',
        heart: 'Heart',
        flag: 'Flag',
        image: 'Image',
        music: 'Music',
        wallet: 'Wallet',
        globe: 'Globe',
        mail: 'Mail',
      },
    },
    share: {
      shareFolderLabel: 'Share folder',
    },
  },
} as const;

/** Minimal DataTransfer stand-in — jsdom doesn't implement the real one. */
const makeDataTransfer = (): DataTransfer => {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    get types(): string[] {
      return Array.from(store.keys());
    },
    effectAllowed: 'all',
    dropEffect: 'none',
  } as unknown as DataTransfer;
};

/** Build a note dataTransfer carrying the given noteId. */
const makeNoteDataTransfer = (noteId: string): DataTransfer => {
  const dt = makeDataTransfer();
  dt.setData(NOTE_DND_MIME, noteId);
  return dt;
};

/** Build a folder dataTransfer carrying the given folderId. */
const makeFolderDataTransfer = (folderId: string): DataTransfer => {
  const dt = makeDataTransfer();
  dt.setData(FOLDER_DND_MIME, folderId);
  return dt;
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const f = (id: string, name: string, parentId: string | null = null, position = 0): FolderNode => ({
  id,
  name,
  parentId,
  position,
  icon: 'folder',
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
  shareCount: 0,
});

const fixture: FolderNode[] = [
  f('clients', 'Clients', null, 0),
  f('acme', 'Acme', 'clients', 0),
  f('globex', 'Globex', 'clients', 1),
  f('internal', 'Internal', null, 1),
];

describe('FolderTree (read-only)', () => {
  it('renders the expanded root tree', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId={null} onSelect={() => undefined} />),
    );
    const tree = within(container).getByRole('tree');
    expect(tree.querySelectorAll('[role="treeitem"]').length).toBe(4);
  });

  it('selecting a row calls onSelect', () => {
    const onSelect = vi.fn();
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId={null} onSelect={onSelect} />),
    );
    fireEvent.click(container.querySelector('[data-id="acme"]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('acme');
  });

  it('collapses and re-expands on the toggle button', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId={null} onSelect={() => undefined} />),
    );
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const toggle = clientsRow.querySelector('button') as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
    fireEvent.click(toggle);
    expect(container.querySelector('[data-id="acme"]')).not.toBeNull();
  });

  it('keyboard ArrowDown navigates down', () => {
    const onSelect = vi.fn();
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId="clients" onSelect={onSelect} />),
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenLastCalledWith('acme');
  });

  it('keyboard ArrowUp navigates up', () => {
    const onSelect = vi.fn();
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId="acme" onSelect={onSelect} />),
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenLastCalledWith('clients');
  });

  it('ArrowLeft on an expanded folder collapses it', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId="clients" onSelect={() => undefined} />),
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'ArrowLeft' });
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
  });

  it('ArrowRight on a collapsed folder expands it', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId="clients" onSelect={() => undefined} />),
    );
    const tree = within(container).getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(container.querySelector('[data-id="acme"]')).not.toBeNull();
  });

  it('Enter on a folder with children toggles expansion', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId="clients" onSelect={() => undefined} />),
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'Enter' });
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
  });

  it('ArrowDown without a selection lands on the first visible item', () => {
    const onSelect = vi.fn();
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId={null} onSelect={onSelect} />),
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('clients');
  });

  it('does not render rename/delete affordances without mutations', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId={null} onSelect={() => undefined} />),
    );
    expect(within(container).queryByLabelText('Rename folder')).toBeNull();
    expect(within(container).queryByLabelText('Delete folder')).toBeNull();
  });
});

describe('FolderTree (mutations)', () => {
  let mutations: FolderMutationHandlers;
  beforeEach(() => {
    mutations = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
    };
  });

  it('reveals per-row rename and delete buttons when mutations are provided', () => {
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    // Each row gets its own rename + delete button.
    expect(within(container).getAllByLabelText('Rename folder').length).toBe(fixture.length);
    expect(within(container).getAllByLabelText('Delete folder').length).toBe(fixture.length);
  });

  it('clicking the rename button starts an inline edit and Enter commits via onRename', async () => {
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    const renameBtn = within(acmeRow).getByLabelText('Rename folder');
    fireEvent.click(renameBtn);

    const input = within(acmeRow).getByLabelText('Folder name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Acme Corp' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mutations.onRename).toHaveBeenCalledWith('acme', 'Acme Corp'));
  });

  it('Escape cancels a rename without calling onRename', () => {
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    fireEvent.click(within(acmeRow).getByLabelText('Rename folder'));
    const input = within(acmeRow).getByLabelText('Folder name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mutations.onRename).not.toHaveBeenCalled();
  });

  it('blanking the name during rename cancels (no-op) instead of erroring', async () => {
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    fireEvent.click(within(acmeRow).getByLabelText('Rename folder'));
    const input = within(acmeRow).getByLabelText('Folder name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mutations.onRename).not.toHaveBeenCalled());
  });

  it('clicking delete asks for confirmation and calls onDelete on confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    fireEvent.click(within(acmeRow).getByLabelText('Delete folder'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(mutations.onDelete).toHaveBeenCalledWith('acme'));
    confirmSpy.mockRestore();
  });

  it('clicking delete does nothing when the user cancels the confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    fireEvent.click(within(acmeRow).getByLabelText('Delete folder'));
    expect(mutations.onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('surfaces a delete error in an alert region', async () => {
    const failing: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => {
        throw new Error('folder not empty');
      }),
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={failing}
        />,
      ),
    );
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    fireEvent.click(within(acmeRow).getByLabelText('Delete folder'));
    await waitFor(() =>
      expect(within(container).getByRole('alert').textContent).toContain('folder not empty'),
    );
    confirmSpy.mockRestore();
  });

  it('F2 on the focused row starts a rename', () => {
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId="acme"
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'F2' });
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    expect(within(acmeRow).getByLabelText('Folder name')).toBeTruthy();
  });

  it('Delete on the focused row asks for confirm and calls onDelete', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId="acme"
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'Delete' });
    await waitFor(() => expect(mutations.onDelete).toHaveBeenCalledWith('acme'));
    confirmSpy.mockRestore();
  });
});

/**
 * Drag-and-drop. Each row exposes three explicit drop-zone elements while a
 * drag is in progress (`[data-drop-zone="before|inside|after"]`) — the test
 * dispatches drag events straight at the zone, so there is no dependency on
 * pointer coordinates or `getBoundingClientRect` (both unreliable in jsdom).
 */
describe('FolderTree (drag-and-drop)', () => {
  let mutations: FolderMutationHandlers;

  beforeEach(() => {
    mutations = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onReorder: vi.fn(async () => undefined),
    };
  });

  const renderTree = (folders = fixture, m: FolderMutationHandlers = mutations) =>
    render(
      wrap(
        <FolderTree folders={folders} selectedId={null} onSelect={() => undefined} mutations={m} />,
      ),
    );

  /** A row's drop zone for a given mode. Present only mid-drag. */
  const zone = (container: HTMLElement, rowId: string, mode: 'before' | 'inside' | 'after') =>
    container.querySelector(
      `[data-drop-zone="${mode}"][data-drop-zone-row="${rowId}"]`,
    ) as HTMLElement | null;

  it('makes rows draggable only when onReorder is supplied', () => {
    const { container, rerender } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={{ onRename: mutations.onRename, onDelete: mutations.onDelete }}
        />,
      ),
    );
    expect(
      (container.querySelector('[data-id="acme"]') as HTMLElement).getAttribute('draggable'),
    ).toBe('false');

    rerender(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    expect(
      (container.querySelector('[data-id="acme"]') as HTMLElement).getAttribute('draggable'),
    ).toBe('true');
  });

  it('drop zones appear only once a drag has started', () => {
    const { container } = renderTree();
    expect(zone(container, 'clients', 'inside')).toBeNull();

    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    fireDrag('dragStart', internalRow, makeDataTransfer());
    expect(zone(container, 'clients', 'inside')).not.toBeNull();
  });

  it('dropping on the inside zone nests the dragged folder', async () => {
    const { container } = renderTree();
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireDrag('dragStart', internalRow, dt);
    const inside = zone(container, 'clients', 'inside') as HTMLElement;
    fireDrag('dragOver', inside, dt);
    fireDrag('drop', inside, dt);

    // clients' children were [acme, globex] → internal appended.
    await waitFor(() =>
      expect(mutations.onReorder).toHaveBeenCalledWith('clients', ['acme', 'globex', 'internal']),
    );
  });

  it('dropping on the before zone reorders the folder *before* the target', async () => {
    const { container } = renderTree();
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireDrag('dragStart', internalRow, dt);
    const before = zone(container, 'globex', 'before') as HTMLElement;
    fireDrag('dragOver', before, dt);
    fireDrag('drop', before, dt);

    await waitFor(() =>
      expect(mutations.onReorder).toHaveBeenCalledWith('clients', ['acme', 'internal', 'globex']),
    );
  });

  it('dropping on the after zone reorders the folder *after* the target', async () => {
    const { container } = renderTree();
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireDrag('dragStart', internalRow, dt);
    const after = zone(container, 'acme', 'after') as HTMLElement;
    fireDrag('dragOver', after, dt);
    fireDrag('drop', after, dt);

    await waitFor(() =>
      expect(mutations.onReorder).toHaveBeenCalledWith('clients', ['acme', 'internal', 'globex']),
    );
  });

  it('reorders two roots at the same level', async () => {
    const { container } = renderTree();
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireDrag('dragStart', internalRow, dt);
    const before = zone(container, 'clients', 'before') as HTMLElement;
    fireDrag('dragOver', before, dt);
    fireDrag('drop', before, dt);

    await waitFor(() =>
      expect(mutations.onReorder).toHaveBeenCalledWith(null, ['internal', 'clients']),
    );
  });

  it('dropping on the root zone moves a nested folder to the top level', async () => {
    const { container } = renderTree();
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    const root = container.querySelector('[data-testid="folder-tree-root"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireDrag('dragStart', acmeRow, dt);
    fireEvent.dragOver(root, { dataTransfer: dt });
    fireEvent.drop(root, { dataTransfer: dt });

    await waitFor(() =>
      expect(mutations.onReorder).toHaveBeenCalledWith(null, ['clients', 'internal', 'acme']),
    );
  });

  it('auto-expands the destination so a nested folder is not hidden', async () => {
    // acme has a hidden child `sub` (acme is collapsed by default).
    const nested: FolderNode[] = [
      f('clients', 'Clients', null, 0),
      f('acme', 'Acme', 'clients', 0),
      f('sub', 'Sub', 'acme', 0),
      f('internal', 'Internal', null, 1),
    ];
    const { container } = renderTree(nested);
    expect(container.querySelector('[data-id="sub"]')).toBeNull();

    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const dt = makeDataTransfer();
    fireDrag('dragStart', internalRow, dt);
    const inside = zone(container, 'acme', 'inside') as HTMLElement;
    fireDrag('dragOver', inside, dt);
    fireDrag('drop', inside, dt);

    // Dropping inside acme auto-expands it → its child `sub` becomes visible.
    await waitFor(() => expect(container.querySelector('[data-id="sub"]')).not.toBeNull());
  });

  it('shows no drop zones on rows inside the dragged folder (cycle guard)', () => {
    const { container } = renderTree();
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;

    fireDrag('dragStart', clientsRow, makeDataTransfer());
    // acme + globex live under clients → not valid drop targets.
    expect(zone(container, 'acme', 'inside')).toBeNull();
    expect(zone(container, 'globex', 'before')).toBeNull();
    // the dragged folder itself gets no zones either.
    expect(zone(container, 'clients', 'inside')).toBeNull();
    // internal (unrelated root) is still droppable.
    expect(zone(container, 'internal', 'inside')).not.toBeNull();
  });

  it('skips a no-op reorder (drop that changes nothing)', async () => {
    const { container } = renderTree();
    // globex dropped just after acme → order [acme, globex] is unchanged.
    const globexRow = container.querySelector('[data-id="globex"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireDrag('dragStart', globexRow, dt);
    const after = zone(container, 'acme', 'after') as HTMLElement;
    fireDrag('dragOver', after, dt);
    fireDrag('drop', after, dt);

    await new Promise((r) => setTimeout(r, 10));
    expect(mutations.onReorder).not.toHaveBeenCalled();
  });

  it('surfaces an onReorder failure in the alert region', async () => {
    const failing: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onReorder: vi.fn(async () => {
        throw new Error('move rejected by server');
      }),
    };
    const { container } = renderTree(fixture, failing);
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireDrag('dragStart', internalRow, dt);
    const inside = zone(container, 'clients', 'inside') as HTMLElement;
    fireDrag('dragOver', inside, dt);
    fireDrag('drop', inside, dt);

    await waitFor(() =>
      expect(within(container).getByRole('alert').textContent).toContain('move rejected by server'),
    );
  });
});

describe('FolderTree (note drop)', () => {
  const renderWithNoteDrop = (onNoteDrop = vi.fn().mockResolvedValue(undefined)) =>
    render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          onNoteDrop={onNoteDrop}
        />,
      ),
    );

  it('calls onNoteDrop(noteId, folderId) when a note is dropped on a folder row', async () => {
    const onNoteDrop = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithNoteDrop(onNoteDrop);

    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const dt = makeNoteDataTransfer('note-abc');

    fireDrag('dragOver', clientsRow, dt);
    fireDrag('drop', clientsRow, dt);

    await waitFor(() => expect(onNoteDrop).toHaveBeenCalledWith('note-abc', 'clients'));
  });

  it('calls onNoteDrop(noteId, null) when a note is dropped on the tree root', async () => {
    const onNoteDrop = vi.fn().mockResolvedValue(undefined);
    renderWithNoteDrop(onNoteDrop);

    const root = screen.getByTestId('folder-tree-root');
    const dt = makeNoteDataTransfer('note-xyz');

    fireDrag('dragOver', root, dt);
    fireDrag('drop', root, dt);

    await waitFor(() => expect(onNoteDrop).toHaveBeenCalledWith('note-xyz', null));
  });

  it('does not call onNoteDrop when a folder (not a note) is dropped', async () => {
    const onNoteDrop = vi.fn().mockResolvedValue(undefined);
    const mutations: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onReorder: vi.fn(async () => undefined),
    };
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
          onNoteDrop={onNoteDrop}
        />,
      ),
    );

    // Start a folder drag
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const dt = makeFolderDataTransfer('internal');
    fireDrag('dragStart', internalRow, dt);

    // Drop on a folder drop zone (folder-reorder path)
    const inside = container.querySelector(
      '[data-drop-zone="inside"][data-drop-zone-row="clients"]',
    ) as HTMLElement;
    fireDrag('dragOver', inside, dt);
    fireDrag('drop', inside, dt);

    await new Promise((r) => setTimeout(r, 10));
    expect(onNoteDrop).not.toHaveBeenCalled();
  });

  it('does not call onNoteDrop when a folder dataTransfer is dropped directly on a folder row root element', async () => {
    const onNoteDrop = vi.fn().mockResolvedValue(undefined);
    const mutations: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onReorder: vi.fn(async () => undefined),
    };
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
          onNoteDrop={onNoteDrop}
        />,
      ),
    );

    // Drop a folder-typed dataTransfer directly on the FolderRow root <div> (the treeitem)
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const dt = makeFolderDataTransfer('internal');

    fireDrag('dragOver', clientsRow, dt);
    fireDrag('drop', clientsRow, dt);

    await new Promise((r) => setTimeout(r, 10));
    expect(onNoteDrop).not.toHaveBeenCalled();
  });
});

describe('FolderTree (share control)', () => {
  it('renders a share button on every folder row when onOpenShare is provided', () => {
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          onOpenShare={vi.fn()}
        />,
      ),
    );
    // The control is share-state-independent: one per visible folder row.
    expect(within(container).getAllByLabelText('Share folder').length).toBe(fixture.length);
  });

  it('renders the share button for a folder that has never been shared (shareCount === 0)', () => {
    const unshared = f('f1', 'Not shared');
    expect(unshared.shareCount).toBe(0);
    const { container } = render(
      wrap(
        <FolderTree
          folders={[unshared]}
          selectedId={null}
          onSelect={() => undefined}
          onOpenShare={vi.fn()}
        />,
      ),
    );
    expect(within(container).getByRole('button', { name: 'Share folder' })).toBeTruthy();
  });

  it('does not render a share button when onOpenShare is omitted', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId={null} onSelect={() => undefined} />),
    );
    expect(within(container).queryByLabelText('Share folder')).toBeNull();
  });

  it('clicking the share button calls onOpenShare with the folder scope', () => {
    const onOpenShare = vi.fn();
    const { container } = render(
      wrap(
        <FolderTree
          folders={[f('f1', 'Some folder')]}
          selectedId={null}
          onSelect={() => undefined}
          onOpenShare={onOpenShare}
        />,
      ),
    );
    fireEvent.click(within(container).getByRole('button', { name: 'Share folder' }));
    expect(onOpenShare).toHaveBeenCalledWith({ kind: 'folder', id: 'f1' });
  });

  it('keeps the share button always visible (not hover-gated) for a shared folder', () => {
    const sharedFolder = { ...f('s1', 'Shared'), shareCount: 2 };
    const { container } = render(
      wrap(
        <FolderTree
          folders={[sharedFolder]}
          selectedId={null}
          onSelect={() => undefined}
          onOpenShare={vi.fn()}
        />,
      ),
    );
    const btn = within(container).getByRole('button', { name: 'Share folder' });
    expect(btn.className.split(' ')).not.toContain('opacity-0');
  });

  it('hover-gates the share button for a folder with no shares', () => {
    const { container } = render(
      wrap(
        <FolderTree
          folders={[f('f1', 'Not shared')]}
          selectedId={null}
          onSelect={() => undefined}
          onOpenShare={vi.fn()}
        />,
      ),
    );
    const btn = within(container).getByRole('button', { name: 'Share folder' });
    expect(btn.className.split(' ')).toContain('opacity-0');
  });
});

describe('FolderTree — folder icons', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders an icon button for each folder when mutations.onSetIcon is given', () => {
    const mutations: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onSetIcon: vi.fn(async () => undefined),
    };
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    const iconBtns = within(container).getAllByLabelText('Change folder icon');
    expect(iconBtns.length).toBe(fixture.length);
  });

  it('opens the picker when the icon button is clicked, without selecting the folder', () => {
    const onSelect = vi.fn();
    const mutations: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onSetIcon: vi.fn(async () => undefined),
    };
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={onSelect}
          mutations={mutations}
        />,
      ),
    );
    const firstIconBtn = within(container).getAllByLabelText(
      'Change folder icon',
    )[0] as HTMLElement;
    fireEvent.click(firstIconBtn);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders the icon without a button when the tree is read-only', () => {
    const { container } = render(
      wrap(<FolderTree folders={fixture} selectedId={null} onSelect={() => undefined} />),
    );
    expect(within(container).queryByLabelText('Change folder icon')).toBeNull();
    // An svg should still be present in the row (the non-interactive icon)
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('calls onSetIcon when an icon is picked', async () => {
    const onSetIcon = vi.fn().mockResolvedValue(undefined);
    const mutations: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onSetIcon,
    };
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );
    // Click the icon button for the first rendered folder (clients)
    const firstIconBtn = within(container).getAllByLabelText(
      'Change folder icon',
    )[0] as HTMLElement;
    fireEvent.click(firstIconBtn);

    // The picker portals into document.body
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();

    // Click the rocket icon cell
    const rocketBtn = dialog.querySelector('[data-icon="rocket"]') as HTMLElement;
    expect(rocketBtn).not.toBeNull();
    fireEvent.click(rocketBtn);

    await waitFor(() => expect(onSetIcon).toHaveBeenCalledWith('clients', 'rocket'));
  });

  it('surfaces an icon-update failure in the alert region', async () => {
    const mutations: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onSetIcon: vi.fn().mockRejectedValue(new Error('icon boom')),
    };
    const { container } = render(
      wrap(
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />,
      ),
    );

    // Open the picker on the first folder (clients)
    const firstIconBtn = within(container).getAllByLabelText(
      'Change folder icon',
    )[0] as HTMLElement;
    fireEvent.click(firstIconBtn);

    // The picker portals into document.body
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();

    // Click the rocket icon cell to trigger handlePickIcon
    const rocketBtn = dialog.querySelector('[data-icon="rocket"]') as HTMLElement;
    expect(rocketBtn).not.toBeNull();
    fireEvent.click(rocketBtn);

    // The rejected promise should route the error into the actionError alert region
    await waitFor(() =>
      expect(within(container).getByRole('alert').textContent).toContain('icon boom'),
    );
  });
});

describe('FolderTree (i18n labels)', () => {
  it('takes the chevron and rename-input aria-labels from the message catalogue', () => {
    // Sentinel values distinct from any English literal — a hardcoded
    // aria-label would never surface these.
    const intlMessages = {
      notes: {
        folderActions: {
          ...messages.notes.folderActions,
          expand: 'AUSKLAPPEN',
          collapse: 'EINKLAPPEN',
          nameInputLabel: 'ORDNERNAME',
        },
        folderIcons: messages.notes.folderIcons,
        share: messages.notes.share,
      },
    };
    const mutations: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
    };
    const { container } = render(
      <NextIntlClientProvider locale="de" messages={intlMessages}>
        <FolderTree
          folders={fixture}
          selectedId={null}
          onSelect={() => undefined}
          mutations={mutations}
        />
      </NextIntlClientProvider>,
    );

    // Inline rename input — labelled from the catalogue, not a literal.
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    fireEvent.click(within(acmeRow).getByLabelText('Rename folder'));
    expect(within(acmeRow).getByLabelText('ORDNERNAME')).toBeTruthy();

    // Chevron — 'Clients' is expanded by default, so it offers "collapse";
    // after a click it offers "expand".
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    fireEvent.click(within(clientsRow).getByLabelText('EINKLAPPEN'));
    expect(within(clientsRow).getByLabelText('AUSKLAPPEN')).toBeTruthy();
  });
});
