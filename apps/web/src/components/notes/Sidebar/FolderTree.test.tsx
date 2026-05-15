// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import { type FolderMutationHandlers, FolderTree } from './FolderTree.tsx';

afterEach(cleanup);

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

describe('FolderTree (drag-and-drop)', () => {
  let mutations: FolderMutationHandlers;
  beforeEach(() => {
    mutations = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onMove: vi.fn(async () => undefined),
    };
  });

  it('makes rows draggable only when onMove is supplied', () => {
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

  it('dropping a folder onto another folder calls onMove with the new parent', async () => {
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
    // Drag "internal" (a root) onto "clients" (another root) → reparent.
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireEvent.dragStart(internalRow, { dataTransfer: dt });
    fireEvent.dragOver(clientsRow, { dataTransfer: dt });
    fireEvent.drop(clientsRow, { dataTransfer: dt });

    await waitFor(() => expect(mutations.onMove).toHaveBeenCalledWith('internal', 'clients'));
  });

  it('dropping on the root zone reparents a child to root (parentId null)', async () => {
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
    // "acme" is a child of "clients" — drag it onto the root drop zone.
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    const root = container.querySelector('[data-testid="folder-tree-root"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireEvent.dragStart(acmeRow, { dataTransfer: dt });
    fireEvent.dragOver(root, { dataTransfer: dt });
    fireEvent.drop(root, { dataTransfer: dt });

    await waitFor(() => expect(mutations.onMove).toHaveBeenCalledWith('acme', null));
  });

  it('refuses to drop a folder into its own descendant (cycle guard)', async () => {
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
    // Drag "clients" onto its own child "acme" — must be rejected.
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireEvent.dragStart(clientsRow, { dataTransfer: dt });
    fireEvent.dragOver(acmeRow, { dataTransfer: dt });
    fireEvent.drop(acmeRow, { dataTransfer: dt });

    // onMove never fires; the descendant guard short-circuits in dragOver/drop.
    await new Promise((r) => setTimeout(r, 10));
    expect(mutations.onMove).not.toHaveBeenCalled();
  });

  it('dropping a folder onto its current parent is a no-op', async () => {
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
    // "acme" already lives under "clients" — dropping it back is a no-op.
    const acmeRow = container.querySelector('[data-id="acme"]') as HTMLElement;
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireEvent.dragStart(acmeRow, { dataTransfer: dt });
    fireEvent.drop(clientsRow, { dataTransfer: dt });

    await new Promise((r) => setTimeout(r, 10));
    expect(mutations.onMove).not.toHaveBeenCalled();
  });

  it('surfaces an onMove failure in the alert region', async () => {
    const failing: FolderMutationHandlers = {
      onRename: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
      onMove: vi.fn(async () => {
        throw new Error('move rejected by server');
      }),
    };
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
    const internalRow = container.querySelector('[data-id="internal"]') as HTMLElement;
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const dt = makeDataTransfer();

    fireEvent.dragStart(internalRow, { dataTransfer: dt });
    fireEvent.drop(clientsRow, { dataTransfer: dt });

    await waitFor(() =>
      expect(within(container).getByRole('alert').textContent).toContain('move rejected by server'),
    );
  });
});
