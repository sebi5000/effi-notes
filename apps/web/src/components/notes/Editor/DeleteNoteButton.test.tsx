// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push, deleteNote } = vi.hoisted(() => ({ push: vi.fn(), deleteNote: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/notes/api-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notes/api-client.ts')>();
  return { ...actual, notesApi: { ...actual.notesApi, delete: deleteNote } };
});

import { ApiError } from '@/lib/notes/api-client.ts';
import { DeleteNoteButton } from './DeleteNoteButton.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    editorActions: {
      delete: 'Delete note',
      confirmDelete: 'Delete note "{title}"?',
      deleteFailed: 'Could not delete the note. Please try again.',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

beforeEach(() => {
  push.mockReset();
  deleteNote.mockReset();
});

describe('DeleteNoteButton', () => {
  it('does nothing when the confirmation is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onError = vi.fn();
    const { container } = render(
      wrap(<DeleteNoteButton noteId="n1" noteTitle="My note" onError={onError} />),
    );
    fireEvent.click(within(container).getByLabelText('Delete note'));
    expect(deleteNote).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('deletes the note and navigates to the index when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteNote.mockResolvedValue({ deleted: true });
    const onError = vi.fn();
    const { container } = render(
      wrap(<DeleteNoteButton noteId="n1" noteTitle="My note" onError={onError} />),
    );
    fireEvent.click(within(container).getByLabelText('Delete note'));
    await waitFor(() => expect(deleteNote).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/notes'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports an error and does not navigate when the delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteNote.mockRejectedValue(new ApiError(500, 'boom', null));
    const onError = vi.fn();
    const { container } = render(
      wrap(<DeleteNoteButton noteId="n1" noteTitle="My note" onError={onError} />),
    );
    fireEvent.click(within(container).getByLabelText('Delete note'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'));
    expect(push).not.toHaveBeenCalled();
  });

  it('falls back to the generic message when the error is not an ApiError', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteNote.mockRejectedValue(new Error('network down'));
    const onError = vi.fn();
    const { container } = render(
      wrap(<DeleteNoteButton noteId="n1" noteTitle="My note" onError={onError} />),
    );
    fireEvent.click(within(container).getByLabelText('Delete note'));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Could not delete the note. Please try again.'),
    );
    expect(push).not.toHaveBeenCalled();
  });
});
