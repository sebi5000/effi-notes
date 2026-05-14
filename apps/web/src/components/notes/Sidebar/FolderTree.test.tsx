// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import { FolderTree } from './FolderTree.tsx';

afterEach(cleanup);

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

describe('FolderTree', () => {
  it('renders the expanded root tree', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <FolderTree folders={fixture} selectedId={null} onSelect={onSelect} />,
    );
    const tree = within(container).getByRole('tree');
    const items = tree.querySelectorAll('[role="treeitem"]');
    // Both roots expanded by default → Clients + Acme + Globex + Internal = 4
    expect(items.length).toBe(4);
  });

  it('selecting a row calls onSelect', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <FolderTree folders={fixture} selectedId={null} onSelect={onSelect} />,
    );
    const acme = container.querySelector('[data-id="acme"]') as HTMLElement;
    fireEvent.click(acme);
    expect(onSelect).toHaveBeenCalledWith('acme');
  });

  it('collapses and re-expands on the toggle button', () => {
    const { container } = render(
      <FolderTree folders={fixture} selectedId={null} onSelect={() => undefined} />,
    );
    const clientsRow = container.querySelector('[data-id="clients"]') as HTMLElement;
    const toggle = clientsRow.querySelector('button') as HTMLButtonElement;
    fireEvent.click(toggle);
    // Now Clients is collapsed → Acme/Globex disappear
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
    expect(container.querySelector('[data-id="clients"]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(container.querySelector('[data-id="acme"]')).not.toBeNull();
  });

  it('keyboard ArrowDown navigates down', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <FolderTree folders={fixture} selectedId="clients" onSelect={onSelect} />,
    );
    const tree = within(container).getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenLastCalledWith('acme');
  });

  it('keyboard ArrowUp navigates up', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <FolderTree folders={fixture} selectedId="acme" onSelect={onSelect} />,
    );
    const tree = within(container).getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenLastCalledWith('clients');
  });

  it('ArrowLeft on an expanded folder collapses it', () => {
    const { container } = render(
      <FolderTree folders={fixture} selectedId="clients" onSelect={() => undefined} />,
    );
    const tree = within(container).getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
  });

  it('ArrowRight on a collapsed folder expands it', () => {
    const { container } = render(
      <FolderTree folders={fixture} selectedId="clients" onSelect={() => undefined} />,
    );
    const tree = within(container).getByRole('tree');
    // First collapse via Left
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(container.querySelector('[data-id="acme"]')).not.toBeNull();
  });

  it('Enter on a folder with children toggles expansion', () => {
    const { container } = render(
      <FolderTree folders={fixture} selectedId="clients" onSelect={() => undefined} />,
    );
    const tree = within(container).getByRole('tree');
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(container.querySelector('[data-id="acme"]')).toBeNull();
  });

  it('ArrowDown without a selection lands on the first visible item', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <FolderTree folders={fixture} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.keyDown(within(container).getByRole('tree'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('clients');
  });
});
