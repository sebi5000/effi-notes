// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowActionsMenu, type RowMenuItem } from './RowActionsMenu.tsx';

afterEach(cleanup);

const item = (overrides: Partial<RowMenuItem> = {}): RowMenuItem => ({
  key: 'rename',
  label: 'Rename',
  icon: '✎',
  onSelect: vi.fn(),
  ...overrides,
});

describe('RowActionsMenu', () => {
  it('renders nothing when items is empty (so the row stays clean)', () => {
    const { container } = render(<RowActionsMenu triggerLabel="More actions" items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('toggles the menu on trigger click', () => {
    render(
      <RowActionsMenu
        triggerLabel="More actions"
        items={[item({ key: 'rename', label: 'Rename' })]}
      />,
    );
    // Closed initially — no menu in the DOM.
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('invokes the item callback and closes the menu after selection', () => {
    const onSelect = vi.fn();
    render(<RowActionsMenu triggerLabel="More actions" items={[item({ onSelect })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<RowActionsMenu triggerLabel="More actions" items={[item()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on outside mousedown', () => {
    render(
      <div>
        <RowActionsMenu triggerLabel="More actions" items={[item()]} />
        <span data-testid="outside">elsewhere</span>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders a badge dot inside the trigger when badge is true', () => {
    render(<RowActionsMenu triggerLabel="More actions" items={[item()]} badge={true} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger.querySelector('.bg-accent')).not.toBeNull();
  });

  it('does not render a badge when badge is false (default)', () => {
    render(<RowActionsMenu triggerLabel="More actions" items={[item()]} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger.querySelector('.bg-accent')).toBeNull();
  });

  it('marks destructive items with the destructive class', () => {
    render(
      <RowActionsMenu
        triggerLabel="More actions"
        items={[item({ key: 'delete', label: 'Delete', destructive: true })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(deleteItem.className).toContain('text-destructive');
  });
});
