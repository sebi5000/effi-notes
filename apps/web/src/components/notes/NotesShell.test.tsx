// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIDEBAR_NARROW_QUERY } from '@/lib/notes/breakpoints.ts';
import { MAX_WIDTH, MIN_WIDTH } from '@/lib/notes/use-sidebar-width.ts';
import { installMatchMedia, type MatchMediaController } from '@/test-matchmedia.ts';

// ---------------------------------------------------------------------------
// next/navigation stubs — NotesShell calls useRouter / usePathname / useSearchParams
// ---------------------------------------------------------------------------
const { push, replace, searchParamsRef } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParamsRef: { current: new URLSearchParams('') },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/notes',
  useSearchParams: () => searchParamsRef.current,
}));

// Stub the UserMenu's signOut server action so the test bundle does not pull
// next-auth (the user menu now mounts inside NotesShell's main area).
vi.mock('@/components/user-menu-actions.ts', () => ({
  signOutAction: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// API client stubs — avoid real network calls from useEffect-driven refreshNotes
// ---------------------------------------------------------------------------
vi.mock('@/lib/notes/api-client.ts', () => ({
  notesApi: {
    list: vi.fn().mockResolvedValue({ notes: [] }),
    get: vi.fn(),
    create: vi.fn(),
    patch: vi.fn(),
    duplicate: vi.fn(),
  },
  foldersApi: {
    list: vi.fn().mockResolvedValue({ folders: [] }),
    create: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  },
  tagsApi: {
    create: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
  collabApi: {},
  sharesApi: {
    markSeen: vi.fn().mockResolvedValue({ marked: true }),
  },
}));

import type { NoteListItem } from '@/lib/api/schemas.ts';
import { notesApi, sharesApi } from '@/lib/notes/api-client.ts';
// Import after mocks are established
import { NotesShell } from './NotesShell.tsx';

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------
const SIDEBAR_WIDTH_KEY = 'effi-notes:sidebar-width';
const SIDEBAR_COLLAPSED_KEY = 'effi-notes:sidebar-collapsed';

let mm: MatchMediaController;

afterEach(cleanup);

beforeEach(() => {
  mm = installMatchMedia();
  localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
  push.mockReset();
  replace.mockReset();
  searchParamsRef.current = new URLSearchParams('');
  vi.mocked(notesApi.list).mockReset().mockResolvedValue({ notes: [] });
  vi.mocked(sharesApi.markSeen).mockReset().mockResolvedValue({ marked: true });
  // stub pointer-capture APIs (not in jsdom)
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
});

// ---------------------------------------------------------------------------
// next-intl messages — minimal set covering notes.shell + notes.sidebar
// (plus other namespaces that Sidebar/CommandBar/FolderTree use)
// ---------------------------------------------------------------------------
const messages = {
  notes: {
    shell: {
      welcome: 'Pick a note from the sidebar',
      emptyHint: 'Or hit ⌘K to search.',
      expandSidebar: 'Expand sidebar',
      resizeHandle: 'Resize sidebar',
    },
    sidebar: {
      foldersHeading: 'Folders',
      tagsHeading: 'Tags',
      notesHeading: 'Notes',
      emptyState: 'No notes here yet.',
      loading: 'Loading…',
      collapseSidebar: 'Collapse sidebar',
    },
    folderActions: {
      newFolder: 'New folder',
      newFolderPlaceholder: 'Folder name',
      rename: 'Rename folder',
      delete: 'Delete folder',
      copyLink: 'Copy link',
      copyLinkCopied: 'Link copied',
      cycle: 'Cycle detected.',
    },
    noteActions: {
      newNote: 'New note',
      renameNote: 'Rename note',
      duplicateNote: 'Duplicate note',
      renameNotePlaceholder: 'Note title',
      copyLink: 'Copy link',
      copyLinkCopied: 'Link copied',
    },
    commandBar: {
      label: 'Search notes',
      placeholder: 'Search…',
      hint: 'Type # for tags, / for folders',
      noTagMatch: 'No tags match.',
      noFolderMatch: 'No folders match.',
      clearSearch: 'Clear search',
    },
    share: {
      shareFolderLabel: 'Share folder',
      shareNoteLabel: 'Share note',
      title: 'Share',
      currentAccess: 'Current access',
      addPeople: 'Add people',
      noShares: 'Not shared with anyone yet.',
      revoke: 'Revoke',
      add: 'Add',
      close: 'Close',
      forever: 'No expiry',
      expiresAt: 'Expires',
      error: 'Error',
      loading: 'Loading…',
      userSearch: 'Search people…',
      access: 'Access level',
      view: 'View',
      edit: 'Edit',
      expiryForever: 'No expiry',
      expiryValue: 'Expiry duration',
      expiryUnit: 'Expiry unit',
    },
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

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

// ---------------------------------------------------------------------------
// Minimal props fixture
// ---------------------------------------------------------------------------
const CURRENT_USER = { id: 'u1', name: 'Test User', color: '#C26A20' };
const TEST_USER = { displayName: 'Test User', email: 'test@example.com' } as const;

const defaultProps = {
  folders: [] as const,
  tags: [] as const,
  initialNotes: [] as const,
  currentUser: CURRENT_USER,
  user: TEST_USER,
  initialNote: null,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotesShell — resize handle presence', () => {
  it('renders a resize handle (role="separator") when the sidebar is expanded', () => {
    // Ensure sidebar is NOT collapsed
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(grid.querySelector('[role="separator"]')).not.toBeNull();
  });

  it('does NOT render a resize handle when the sidebar is collapsed', () => {
    // Pre-collapse via localStorage
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(grid.querySelector('[role="separator"]')).toBeNull();
  });
});

describe('NotesShell — keyboard resize via handle', () => {
  const getGridAndHandle = (container: HTMLElement) => {
    const grid = within(container).getByTestId('notes-shell-grid');
    const handle = grid.querySelector('[role="separator"]') as HTMLElement;
    return { grid, handle };
  };

  const getFirstColWidth = (grid: HTMLElement): number => {
    const style = grid.style.gridTemplateColumns;
    // e.g. "480px 1fr" → 480
    return Number.parseFloat(style.split(' ')[0] ?? '0');
  };

  it('ArrowRight widens the sidebar (gridTemplateColumns first column increases)', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const { grid, handle } = getGridAndHandle(container);
    const widthBefore = getFirstColWidth(grid);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    const widthAfter = getFirstColWidth(grid);
    expect(widthAfter).toBeGreaterThan(widthBefore);
  });

  it('ArrowLeft narrows the sidebar (gridTemplateColumns first column decreases)', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    // Use a width above the minimum so there is room to narrow
    localStorage.setItem(SIDEBAR_WIDTH_KEY, '600');

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const { grid, handle } = getGridAndHandle(container);
    const widthBefore = getFirstColWidth(grid);

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    const widthAfter = getFirstColWidth(grid);
    expect(widthAfter).toBeLessThan(widthBefore);
  });

  it('repeated ArrowRight never exceeds MAX_WIDTH', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    // Start near max
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(MAX_WIDTH - 16));

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const { grid, handle } = getGridAndHandle(container);

    // Press ArrowRight many times
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
    }

    const widthAfter = getFirstColWidth(grid);
    expect(widthAfter).toBeLessThanOrEqual(MAX_WIDTH);
  });

  it('repeated ArrowLeft never goes below MIN_WIDTH', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    // Start near min
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(MIN_WIDTH + 16));

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const { grid, handle } = getGridAndHandle(container);

    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    }

    const widthAfter = getFirstColWidth(grid);
    expect(widthAfter).toBeGreaterThanOrEqual(MIN_WIDTH);
  });
});

describe('NotesShell — pointer drag updates the column width', () => {
  it('pointerDown + pointerMove widens the sidebar in real time', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    // Known starting width
    localStorage.setItem(SIDEBAR_WIDTH_KEY, '480');

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    const handle = grid.querySelector('[role="separator"]') as HTMLElement;

    const startX = 480;
    const moveX = 560;

    fireEvent.pointerDown(handle, { clientX: startX, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: moveX, pointerId: 1 });

    const style = grid.style.gridTemplateColumns;
    const widthPx = Number.parseFloat(style.split(' ')[0] ?? '0');
    // Width should reflect the delta
    expect(widthPx).toBeGreaterThan(480);
  });

  it('pointerUp commits the width and re-enables text selection', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, '480');

    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    const handle = grid.querySelector('[role="separator"]') as HTMLElement;

    fireEvent.pointerDown(handle, { clientX: 480, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 540, pointerId: 1 });

    // After commit, transition class should be back (dragWidth null → gridTemplateColumns still set)
    const style = grid.style.gridTemplateColumns;
    const widthPx = Number.parseFloat(style.split(' ')[0] ?? '0');
    expect(widthPx).toBeGreaterThan(480);
    // userSelect should be cleared
    expect(document.body.style.userSelect).toBe('');
  });
});

describe('NotesShell — Shared with me section', () => {
  it('surfaces a shared folder in the Shared with me section', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);

    const ownFolder = {
      id: 'f-own',
      name: 'My Own Folder',
      parentId: null,
      icon: 'folder',
      position: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      shareCount: 0,
    };
    const sharedFolder = {
      id: 'f-shared',
      name: 'Alice Shared Folder',
      parentId: null,
      icon: 'folder',
      position: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      shareCount: 0,
      sharedWithMe: {
        shareId: 's1',
        sharedByName: 'Alice',
        access: 'EDIT' as const,
        seenAt: null,
      },
    };

    const { getByRole, getByText } = render(
      wrap(<NotesShell {...defaultProps} folders={[ownFolder, sharedFolder]} />),
    );

    // The "Shared with me" section heading must be present
    const sharedSection = getByRole('region', { name: 'Shared with me' });
    expect(sharedSection).not.toBeNull();

    // The shared folder's name appears inside that section
    expect(within(sharedSection).getByText('Alice Shared Folder')).not.toBeNull();

    // The own folder's name is NOT inside the Shared with me section
    expect(within(sharedSection).queryByText('My Own Folder')).toBeNull();

    // The own folder's name IS present in the document (in the normal folder tree)
    expect(getByText('My Own Folder')).not.toBeNull();
  });

  it('marks a shared folder seen when it is opened', () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);

    const sharedFolder = {
      id: 'f-shared',
      name: 'Alice Shared Folder',
      parentId: null,
      icon: 'folder',
      position: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      shareCount: 0,
      sharedWithMe: {
        shareId: 's1',
        sharedByName: 'Alice',
        access: 'EDIT' as const,
        seenAt: null,
      },
    };

    const { getByRole } = render(wrap(<NotesShell {...defaultProps} folders={[sharedFolder]} />));

    const sharedSection = getByRole('region', { name: 'Shared with me' });
    // The folder name lives inside a <button> — getByRole scopes to that button directly
    const folderButton = within(sharedSection).getByRole('button', {
      name: (_, el) => el.textContent?.includes('Alice Shared Folder') ?? false,
    });
    fireEvent.click(folderButton);

    expect(vi.mocked(sharesApi.markSeen)).toHaveBeenCalledWith('s1');
  });

  // A directly-shared note lives outside the recipient's own folders. The
  // folder-scoped notes list (`refreshNotes`) drops it the moment a folder is
  // selected — so the "Shared with me" section must source these notes from
  // an unfiltered fetch, independent of the folder filter.
  const sharedFolder = {
    id: 'f-shared',
    name: 'Alice Shared Folder',
    parentId: null,
    icon: 'folder',
    position: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    shareCount: 0,
    sharedWithMe: {
      shareId: 's-folder-1',
      sharedByName: 'Alice',
      access: 'EDIT' as const,
      seenAt: null,
    },
  };
  const directlySharedNote: NoteListItem = {
    id: 'n-direct',
    title: 'Alice Direct Note',
    snippet: '',
    folderId: null,
    authorId: 'alice',
    archivedAt: null,
    updatedAt: '2025-01-02T00:00:00.000Z',
    tags: [],
    shareCount: 0,
    sharedWithMe: {
      shareId: 's-note-1',
      sharedByName: 'Alice',
      access: 'VIEW' as const,
      seenAt: null,
    },
  };

  /** Folder-scoped list is empty; the unfiltered list carries the shared note. */
  const browseSharedFolder = () => {
    searchParamsRef.current = new URLSearchParams(
      `q=${encodeURIComponent('/Alice Shared Folder')}`,
    );
    vi.mocked(notesApi.list).mockImplementation(async (query) => {
      if (query?.folderId !== undefined || query?.tagId !== undefined) {
        return { notes: [] };
      }
      return { notes: [directlySharedNote] };
    });
  };

  it('keeps a directly-shared note visible after a folder is selected', async () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    browseSharedFolder();

    const { findByRole } = render(wrap(<NotesShell {...defaultProps} folders={[sharedFolder]} />));

    const sharedSection = await findByRole('region', { name: 'Shared with me' });
    expect(await within(sharedSection).findByText('Alice Direct Note')).not.toBeNull();
  });

  it('marks a directly-shared note seen when opened while a folder is selected', async () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    browseSharedFolder();

    const { findByRole } = render(wrap(<NotesShell {...defaultProps} folders={[sharedFolder]} />));

    const sharedSection = await findByRole('region', { name: 'Shared with me' });
    const noteLabel = await within(sharedSection).findByText('Alice Direct Note');
    fireEvent.click(noteLabel.closest('button') as HTMLElement);

    expect(vi.mocked(sharesApi.markSeen)).toHaveBeenCalledWith('s-note-1');
  });
});

describe('NotesShell — responsive sidebar (narrow viewport)', () => {
  const firstCol = (grid: HTMLElement): string =>
    grid.style.gridTemplateColumns.split(' ')[0] ?? '';

  it('auto-collapses the sidebar below 1280px', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(firstCol(grid)).toBe('0px');
  });

  it('does not render the resize handle when narrow', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(grid.querySelector('[role="separator"]')).toBeNull();
  });

  it('opens the narrow sidebar to a fixed MIN_WIDTH column', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const { container, getByRole } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    fireEvent.click(getByRole('button', { name: 'Expand sidebar' }));
    expect(firstCol(grid)).toBe(`${MIN_WIDTH}px`);
  });

  it('auto-collapses the sidebar when a note is opened while narrow', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const note = {
      id: 'n1',
      title: 'Quarterly Review',
      snippet: '',
      folderId: null,
      authorId: 'u1',
      archivedAt: null,
      updatedAt: '2025-01-01T00:00:00.000Z',
      tags: [],
      shareCount: 0,
    };
    const { container, getByRole, getByText } = render(
      wrap(<NotesShell {...defaultProps} initialNotes={[note]} />),
    );
    const grid = within(container).getByTestId('notes-shell-grid');
    fireEvent.click(getByRole('button', { name: 'Expand sidebar' }));
    expect(firstCol(grid)).toBe(`${MIN_WIDTH}px`);
    fireEvent.click(getByText('Quarterly Review'));
    expect(firstCol(grid)).toBe('0px');
  });

  it('keeps the sidebar open when a folder is selected while narrow', () => {
    mm.set(SIDEBAR_NARROW_QUERY, true);
    const folder = {
      id: 'f1',
      name: 'Engineering',
      parentId: null,
      icon: 'folder',
      position: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      shareCount: 0,
    };
    const { container, getByRole, getByText } = render(
      wrap(<NotesShell {...defaultProps} folders={[folder]} />),
    );
    const grid = within(container).getByTestId('notes-shell-grid');
    fireEvent.click(getByRole('button', { name: 'Expand sidebar' }));
    fireEvent.click(getByText('Engineering'));
    expect(firstCol(grid)).toBe(`${MIN_WIDTH}px`);
  });

  it('stays expanded above 1280px (wide default)', () => {
    // installMatchMedia defaults every query to non-matching → wide viewport.
    const { container } = render(wrap(<NotesShell {...defaultProps} />));
    const grid = within(container).getByTestId('notes-shell-grid');
    expect(grid.querySelector('[role="separator"]')).not.toBeNull();
    expect(firstCol(grid)).not.toBe('0px');
  });
});
