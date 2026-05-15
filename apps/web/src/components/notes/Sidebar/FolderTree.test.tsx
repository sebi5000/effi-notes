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
    },
  },
} as const;

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
