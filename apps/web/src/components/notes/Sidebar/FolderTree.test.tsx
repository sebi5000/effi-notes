// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
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
      cycle: "A folder can't be moved into one of its own descendants.",
    },
  },
} as const;

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
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
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
