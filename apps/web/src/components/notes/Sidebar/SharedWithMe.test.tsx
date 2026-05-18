// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode, NoteListItem } from '@/lib/api/schemas.ts';
import { SharedWithMe } from './SharedWithMe.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    sharedWithMe: {
      heading: 'Shared with me',
      sharedBy: 'Shared by {name}',
      accessView: 'View',
      accessEdit: 'Can edit',
      unseenLabel: 'Not opened yet',
      expandFolder: 'Expand folder',
      collapseFolder: 'Collapse folder',
    },
  },
} as const;

const folder = (
  id: string,
  parentId: string | null,
  share?: Partial<NonNullable<FolderNode['sharedWithMe']>>,
): FolderNode => ({
  id,
  name: id,
  parentId,
  position: 0,
  icon: 'folder',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
  shareCount: 0,
  ...(share
    ? {
        sharedWithMe: {
          shareId: `s-${id}`,
          sharedByName: 'Alice',
          access: 'EDIT',
          seenAt: null,
          ...share,
        },
      }
    : {}),
});

const note = (
  id: string,
  share?: Partial<NonNullable<NoteListItem['sharedWithMe']>>,
): NoteListItem => ({
  id,
  title: id,
  snippet: '',
  folderId: null,
  authorId: 'someone',
  archivedAt: null,
  updatedAt: '2026-05-18T00:00:00.000Z',
  tags: [],
  shareCount: 0,
  ...(share
    ? {
        sharedWithMe: {
          shareId: `s-${id}`,
          sharedByName: 'Bob',
          access: 'VIEW',
          seenAt: null,
          ...share,
        },
      }
    : {}),
});

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const noop = () => undefined;

describe('SharedWithMe', () => {
  it('renders nothing when there is nothing shared', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    expect(container.querySelector('section')).toBeNull();
  });

  it('renders a shared folder with its sharer attribution', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('clients', null, {})]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    expect(within(container).getByText('clients')).toBeTruthy();
    expect(container.textContent).toContain('Shared by Alice');
    expect(container.textContent).toContain('Can edit');
  });

  it('shows the unseen count for not-yet-opened shares', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('a', null, { seenAt: null })]}
          sharedNotes={[note('n', { seenAt: null })]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    const heading = within(container).getByText('Shared with me').closest('h3');
    expect(heading?.textContent).toContain('2');
  });

  it('selecting a shared folder calls onSelectFolder', () => {
    const onSelectFolder = vi.fn();
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('clients', null, {})]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={onSelectFolder}
          onSelectNote={noop}
        />,
      ),
    );
    fireEvent.click(within(container).getByText('clients'));
    expect(onSelectFolder).toHaveBeenCalledWith('clients');
  });

  it('clicking a shared note calls onSelectNote', () => {
    const onSelectNote = vi.fn();
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[]}
          sharedNotes={[note('roadmap', {})]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={onSelectNote}
        />,
      ),
    );
    fireEvent.click(within(container).getByText('roadmap'));
    expect(onSelectNote).toHaveBeenCalledWith('roadmap');
  });

  it('expands a shared folder to reveal its children', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('root', null, {}), folder('child', 'root')]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    expect(within(container).queryByText('child')).toBeNull();
    fireEvent.click(within(container).getByRole('button', { name: 'Expand folder' }));
    expect(within(container).getByText('child')).toBeTruthy();
  });

  it('does not show an unseen dot for an already-seen share', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[]}
          sharedNotes={[note('seen-note', { seenAt: '2026-05-18T00:00:00.000Z' })]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
    const heading = within(container).getByText('Shared with me').closest('h3');
    expect(heading?.textContent ?? '').not.toContain('1');
  });

  it('shows the View access badge for a VIEW share', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[]}
          sharedNotes={[note('roadmap', { access: 'VIEW' })]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    expect(container.textContent).toContain('View');
  });
});
