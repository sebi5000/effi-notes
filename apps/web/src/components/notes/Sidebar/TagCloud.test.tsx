// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagCloud } from './TagCloud.tsx';

afterEach(cleanup);

const tags = [
  { id: 't1', name: 'strategy', color: '#C26A20' },
  { id: 't2', name: 'pricing', color: null },
];

describe('TagCloud', () => {
  it('renders nothing when there are no tags', () => {
    const { container } = render(
      <TagCloud tags={[]} selectedId={null} onToggle={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one button per tag', () => {
    const { container } = render(
      <TagCloud tags={tags} selectedId={null} onToggle={() => undefined} />,
    );
    const list = within(container).getByLabelText('Tags');
    expect(list.querySelectorAll('button').length).toBe(2);
  });

  it('toggles the selection on click', () => {
    const onToggle = vi.fn();
    const { container } = render(<TagCloud tags={tags} selectedId={null} onToggle={onToggle} />);
    fireEvent.click(within(container).getByText('strategy'));
    expect(onToggle).toHaveBeenCalledWith('t1');
  });

  it('clears the selection when the active tag is clicked again', () => {
    const onToggle = vi.fn();
    const { container } = render(<TagCloud tags={tags} selectedId="t1" onToggle={onToggle} />);
    fireEvent.click(within(container).getByText('strategy'));
    expect(onToggle).toHaveBeenCalledWith(null);
  });

  it('marks the active tag with aria-pressed', () => {
    const { container } = render(
      <TagCloud tags={tags} selectedId="t1" onToggle={() => undefined} />,
    );
    const pressed = container.querySelector('button[aria-pressed="true"]');
    expect(pressed?.textContent).toContain('strategy');
  });
});
