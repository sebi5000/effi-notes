// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableNoteTitle } from './EditableNoteTitle.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    noteActions: {
      renameNote: 'Rename note',
      renameNotePlaceholder: 'Note title',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages as Record<string, unknown>}>
    {ui}
  </NextIntlClientProvider>
);

describe('EditableNoteTitle', () => {
  it('renders the title as a heading and a rename button', () => {
    const { getByRole } = render(wrap(<EditableNoteTitle title="Hello" onCommit={vi.fn()} />));
    expect(getByRole('heading', { name: 'Hello' })).toBeTruthy();
    expect(getByRole('button', { name: 'Rename note' })).toBeTruthy();
  });

  it('clicking the pencil shows an input focused and pre-filled', () => {
    const { getByRole, getByLabelText } = render(
      wrap(<EditableNoteTitle title="Hello" onCommit={vi.fn()} />),
    );
    fireEvent.click(getByRole('button', { name: 'Rename note' }));
    const input = getByLabelText('Note title') as HTMLInputElement;
    expect(input.value).toBe('Hello');
    expect(document.activeElement).toBe(input);
  });

  it('commits the trimmed value on Enter', () => {
    const onCommit = vi.fn();
    const { getByRole, getByLabelText } = render(
      wrap(<EditableNoteTitle title="Hello" onCommit={onCommit} />),
    );
    fireEvent.click(getByRole('button', { name: 'Rename note' }));
    const input = getByLabelText('Note title');
    fireEvent.change(input, { target: { value: '  New title  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('New title');
  });

  it('Escape cancels without calling onCommit', () => {
    const onCommit = vi.fn();
    const { getByRole, getByLabelText } = render(
      wrap(<EditableNoteTitle title="Hello" onCommit={onCommit} />),
    );
    fireEvent.click(getByRole('button', { name: 'Rename note' }));
    const input = getByLabelText('Note title');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(getByRole('heading', { name: 'Hello' })).toBeTruthy();
  });

  it('a whitespace-only value cancels (no onCommit)', () => {
    const onCommit = vi.fn();
    const { getByRole, getByLabelText } = render(
      wrap(<EditableNoteTitle title="Hello" onCommit={onCommit} />),
    );
    fireEvent.click(getByRole('button', { name: 'Rename note' }));
    fireEvent.change(getByLabelText('Note title'), { target: { value: '   ' } });
    fireEvent.keyDown(getByLabelText('Note title'), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('an unchanged value does not call onCommit', () => {
    const onCommit = vi.fn();
    const { getByRole, getByLabelText } = render(
      wrap(<EditableNoteTitle title="Hello" onCommit={onCommit} />),
    );
    fireEvent.click(getByRole('button', { name: 'Rename note' }));
    fireEvent.keyDown(getByLabelText('Note title'), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur commits a changed value', () => {
    const onCommit = vi.fn();
    const { getByRole, getByLabelText } = render(
      wrap(<EditableNoteTitle title="Hello" onCommit={onCommit} />),
    );
    fireEvent.click(getByRole('button', { name: 'Rename note' }));
    fireEvent.change(getByLabelText('Note title'), { target: { value: 'Blurred' } });
    fireEvent.blur(getByLabelText('Note title'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Blurred');
  });
});
