'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FolderNode, NoteDetail, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { foldersApi, notesApi, sharesApi, tagsApi } from '@/lib/notes/api-client.ts';
import { SIDEBAR_NARROW_QUERY } from '@/lib/notes/breakpoints.ts';
import { parseCommand, resolveTagId } from '@/lib/notes/command.ts';
import type { FolderIcon } from '@/lib/notes/folder-icons.ts';
import { folderPath, resolveFolderPath } from '@/lib/notes/folder-tree.ts';
import { partitionSharedFolders } from '@/lib/notes/shared-folders.ts';
import { tagColor } from '@/lib/notes/tag-color.ts';
import { useResponsiveCollapse } from '@/lib/notes/use-responsive-collapse.ts';
import { useSidebarCollapsed } from '@/lib/notes/use-sidebar-collapsed.ts';
import {
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  useSidebarWidth,
} from '@/lib/notes/use-sidebar-width.ts';
import { UserMenu } from '../UserMenu.tsx';
import { EditableNoteTitle } from './EditableNoteTitle.tsx';
import { NoteEditor } from './Editor/NoteEditor.tsx';
import { Sidebar } from './Sidebar/index.tsx';
import { SidebarResizeHandle } from './SidebarResizeHandle.tsx';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  initialNotes: ReadonlyArray<NoteListItem>;
  currentUser: { id: string; name: string; color: string };
  /** The signed-in user, for the top-right profile menu. */
  user: { displayName: string | null; email: string };
  initialNote: NoteDetail | null;
};

/** ISO timestamps sort lexically; newest-edited first. Defensive guard on top
 *  of the API's own `orderBy: { updatedAt: 'desc' }`. */
const byUpdatedAtDesc = (notes: ReadonlyArray<NoteListItem>): NoteListItem[] =>
  [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const DEFAULT_NOTE_TITLE = 'Neue Notiz';

const qSuffix = (q: string): string => (q.length > 0 ? `?q=${encodeURIComponent(q)}` : '');

export function NotesShell({
  folders: initialFolders,
  tags: initialTags,
  initialNotes,
  currentUser,
  user,
  initialNote,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('notes.shell');
  const [persistedCollapsed, togglePersistedCollapsed] = useSidebarCollapsed();
  const {
    collapsed: sidebarCollapsed,
    toggle: toggleSidebar,
    collapse: collapseSidebar,
    isNarrow,
  } = useResponsiveCollapse({
    query: SIDEBAR_NARROW_QUERY,
    collapsed: persistedCollapsed,
    toggle: togglePersistedCollapsed,
  });
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  // When the sidebar collapses mid-drag the handle unmounts without committing.
  // Drop the stale transient width during render so a later expand restores the
  // persisted width, not the interrupted drag value. This is React's documented
  // "adjusting state when a prop changes" pattern — guarded so it converges.
  const [wasCollapsed, setWasCollapsed] = useState(sidebarCollapsed);
  if (sidebarCollapsed !== wasCollapsed) {
    setWasCollapsed(sidebarCollapsed);
    if (sidebarCollapsed && dragWidth !== null) {
      setDragWidth(null);
    }
  }

  const effectiveWidth = dragWidth ?? sidebarWidth;

  // Suppress page-wide text selection while a drag is in progress. The cleanup
  // re-enables it — it runs when the drag commits (dragWidth → null), when the
  // sidebar collapses (the handle unmounts mid-drag with no pointerup), and on
  // unmount — so userSelect can never get stuck as 'none'.
  useEffect(() => {
    if (dragWidth === null || sidebarCollapsed) return;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = '';
    };
  }, [dragWidth, sidebarCollapsed]);

  const query = searchParams.get('q') ?? '';
  const [folders, setFolders] = useState<ReadonlyArray<FolderNode>>(initialFolders);
  const [tags, setTags] = useState<ReadonlyArray<TagItem>>(initialTags);
  const [noteDetail, setNoteDetail] = useState<NoteDetail | null>(initialNote);

  // The URL `?q=` param is the single source of truth for the filter. It is
  // parsed into a resolved folder/tag id; an unresolvable partial path (still
  // being typed) leaves both null → the list shows all notes.
  const parsed = useMemo(() => parseCommand(query), [query]);
  const folderId = useMemo(
    () => (parsed.kind === 'folder' ? resolveFolderPath(folders, parsed.path) : null),
    [parsed, folders],
  );
  const tagId = useMemo(
    () => (parsed.kind === 'tag' ? resolveTagId(tags, parsed.needle) : null),
    [parsed, tags],
  );

  const filterActive = folderId !== null || tagId !== null;
  const [notes, setNotes] = useState<ReadonlyArray<NoteListItem>>(() =>
    filterActive ? [] : byUpdatedAtDesc(initialNotes),
  );
  const [pending, setPending] = useState(filterActive);

  const { own: ownFolders, shared: sharedFolders } = useMemo(
    () => partitionSharedFolders(folders),
    [folders],
  );
  // Notes shared directly with the user. Kept as its own state — NOT derived
  // from `notes` — because `notes` is folder/tag-scoped: deriving from it would
  // make directly-shared notes vanish from the section the moment the user
  // browses into any folder. Populated by an unfiltered fetch (see below).
  const [sharedNotes, setSharedNotes] = useState<ReadonlyArray<NoteListItem>>([]);
  const ownNotes = useMemo(() => notes.filter((n) => n.sharedWithMe === undefined), [notes]);

  const notesReqRef = useRef(0);
  const sharedNotesReqRef = useRef(0);

  // Cancel-safe list fetch — a stale request never overwrites a newer one.
  const refreshNotes = useCallback(async () => {
    const reqId = ++notesReqRef.current;
    setPending(true);
    try {
      const list = await notesApi.list({
        ...(folderId !== null ? { folderId } : {}),
        ...(tagId !== null ? { tagId } : {}),
      });
      if (notesReqRef.current === reqId) setNotes(byUpdatedAtDesc(list.notes));
    } catch {
      // keep the previous list on error
    } finally {
      if (notesReqRef.current === reqId) setPending(false);
    }
  }, [folderId, tagId]);

  // Re-fetch whenever the resolved filter changes. Keyed on folderId/tagId —
  // not raw `query` — so typing free text never triggers a list fetch.
  //
  // Skip the very first fetch when the URL state matches what the server
  // already passed in `initialNotes`: the server-rendered page loaded the
  // same query, so the immediate client refresh was redundant network +
  // duplicated `listAccessibleScope()` work (QA review 2026-05-20, P2).
  const initialNotesRef = useRef(filterActive === false ? initialNotes : null);
  useEffect(() => {
    if (initialNotesRef.current !== null) {
      // First effect run after hydration with no active filter — initialNotes
      // already mirrors the URL; consume the marker and skip the fetch.
      initialNotesRef.current = null;
      setPending(false);
      return;
    }
    (async () => {
      await refreshNotes();
    })();
  }, [refreshNotes]);

  // Cancel-safe fetch of the directly-shared notes. Uses the API's
  // `section=shared` mode so the server returns just those rows — we no
  // longer load every note and filter client-side (QA review 2026-05-20, P2).
  const refreshSharedNotes = useCallback(async () => {
    const reqId = ++sharedNotesReqRef.current;
    try {
      const list = await notesApi.list({ section: 'shared' });
      if (sharedNotesReqRef.current === reqId) {
        setSharedNotes(byUpdatedAtDesc(list.notes));
      }
    } catch {
      // keep the previous list on error
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refreshSharedNotes();
    })();
  }, [refreshSharedNotes]);

  const setQuery = useCallback(
    (next: string) => {
      router.replace(`${pathname}${qSuffix(next)}`);
    },
    [router, pathname],
  );

  const markShareSeen = useCallback(
    (share: { shareId: string; seenAt: string | null } | undefined) => {
      if (share === undefined || share.seenAt !== null) return;
      void sharesApi.markSeen(share.shareId).catch(() => {
        // a failed mark-seen self-heals: the next fetch still reports it unseen
      });
      const seenAt = new Date().toISOString();
      setFolders((prev) =>
        prev.map((f) =>
          f.sharedWithMe?.shareId === share.shareId
            ? { ...f, sharedWithMe: { ...f.sharedWithMe, seenAt } }
            : f,
        ),
      );
      setSharedNotes((prev) =>
        prev.map((n) =>
          n.sharedWithMe?.shareId === share.shareId
            ? { ...n, sharedWithMe: { ...n.sharedWithMe, seenAt } }
            : n,
        ),
      );
    },
    [],
  );

  const selectFolder = useCallback(
    (id: string | null) => {
      if (id === null) setQuery('');
      else setQuery(`/${folderPath(folders, id)}`);
      markShareSeen(folders.find((f) => f.id === id)?.sharedWithMe);
    },
    [setQuery, folders, markShareSeen],
  );

  const openNote = useCallback(
    async (id: string) => {
      router.push(`/notes/${id}${qSuffix(query)}`);
      // A directly-shared note opened from the section is not in the
      // folder-scoped `notes` list — fall back to `sharedNotes` so its
      // share still gets marked seen.
      const opened = notes.find((n) => n.id === id) ?? sharedNotes.find((n) => n.id === id);
      markShareSeen(opened?.sharedWithMe);
      collapseSidebar();
      try {
        const detail = await notesApi.get(id);
        setNoteDetail(detail);
      } catch {
        // ignore — the destination page re-fetches server-side
      }
    },
    [router, query, notes, sharedNotes, markShareSeen, collapseSidebar],
  );

  const refreshFolders = useCallback(async () => {
    try {
      const res = await foldersApi.list();
      setFolders(res.folders);
    } catch {
      // ignore — keep current state
    }
  }, []);

  // A share granted/revoked in the dialog changes `shareCount` server-side; re-pull
  // folders + notes so the row "shared" indicator reflects it without a reload.
  const handleSharesChanged = useCallback(async () => {
    await Promise.all([refreshFolders(), refreshNotes(), refreshSharedNotes()]);
  }, [refreshFolders, refreshNotes, refreshSharedNotes]);

  const handleCreateFolder = useCallback(
    async (name: string, parentId: string | null) => {
      await foldersApi.create({
        name,
        ...(parentId !== null ? { parentId } : {}),
      });
      await refreshFolders();
    },
    [refreshFolders],
  );

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      await foldersApi.patch(id, { name });
      await refreshFolders();
    },
    [refreshFolders],
  );

  const handleSetFolderIcon = useCallback(
    async (id: string, icon: FolderIcon) => {
      await foldersApi.patch(id, { icon });
      await refreshFolders();
    },
    [refreshFolders],
  );

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      await foldersApi.delete(id);
      await refreshFolders();
      if (folderId === id) setQuery('');
    },
    [refreshFolders, folderId, setQuery],
  );

  const handleReorderFolders = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      await foldersApi.reorder(parentId, orderedIds);
      await refreshFolders();
    },
    [refreshFolders],
  );

  const handleCreateNote = useCallback(async () => {
    const created = await notesApi.create({
      title: DEFAULT_NOTE_TITLE,
      ...(folderId !== null ? { folderId } : {}),
    });
    router.push(`/notes/${created.id}${qSuffix(query)}`);
  }, [folderId, router, query]);

  const handleRenameNote = useCallback(async (id: string, title: string) => {
    await notesApi.patch(id, { title, titleManuallySet: true });
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
    setNoteDetail((prev) =>
      prev && prev.id === id ? { ...prev, title, titleManuallySet: true } : prev,
    );
  }, []);

  const handleDuplicateNote = useCallback(
    async (id: string) => {
      const created = await notesApi.duplicate(id);
      router.push(`/notes/${created.id}${qSuffix(query)}`);
    },
    [router, query],
  );

  const handleMoveNote = useCallback(
    async (noteId: string, targetFolderId: string | null) => {
      const note = notes.find((n) => n.id === noteId);
      if (note && note.folderId === targetFolderId) return; // no-op: already there
      await notesApi.patch(noteId, { folderId: targetFolderId });
      await refreshNotes();
    },
    [notes, refreshNotes],
  );

  const handleDeleteNote = useCallback(
    async (id: string) => {
      // Hard delete — mirrors the editor's DeleteNoteButton semantics. The
      // sidebar already showed the confirm; here we just commit + refresh and
      // bounce off the note if it was the one being viewed.
      await notesApi.delete(id);
      await refreshNotes();
      if (noteDetail?.id === id) router.push(`/notes${qSuffix(query)}`);
    },
    [refreshNotes, noteDetail?.id, router, query],
  );

  const handleSetNoteTags = useCallback(
    async (tagIds: string[]) => {
      if (!noteDetail) return;
      const updated = await notesApi.patch(noteDetail.id, { tagIds });
      setNoteDetail(updated);
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? { ...n, tags: updated.tags } : n)));
    },
    [noteDetail],
  );

  const handleCreateTag = useCallback(async (name: string): Promise<TagItem> => {
    const tag = await tagsApi.create({ name, color: tagColor(name) });
    setTags((prev) => (prev.some((tg) => tg.id === tag.id) ? prev : [...prev, tag]));
    return tag;
  }, []);

  return (
    <div
      data-testid="notes-shell-grid"
      className={`relative grid h-screen ${
        dragWidth === null ? 'transition-[grid-template-columns] duration-200' : ''
      }`}
      style={{
        gridTemplateColumns: sidebarCollapsed
          ? '0px 1fr'
          : isNarrow
            ? `${MIN_WIDTH}px 1fr`
            : `${effectiveWidth}px 1fr`,
      }}
    >
      {sidebarCollapsed || isNarrow ? null : (
        <SidebarResizeHandle
          width={effectiveWidth}
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          defaultWidth={DEFAULT_WIDTH}
          label={t('resizeHandle')}
          onResize={(w, committed) => {
            if (committed) {
              setDragWidth(null);
              setSidebarWidth(w);
            } else {
              setDragWidth(w);
            }
          }}
        />
      )}
      <div className="overflow-hidden">
        <Sidebar
          folders={ownFolders}
          tags={tags}
          notes={ownNotes}
          pending={pending}
          sharedFolders={sharedFolders}
          sharedNotes={sharedNotes}
          query={query}
          selectedFolderId={folderId}
          selectedNoteId={noteDetail?.id ?? null}
          onQueryChange={setQuery}
          onSelectFolder={selectFolder}
          onSelectNote={openNote}
          onCollapse={toggleSidebar}
          onSharesChanged={handleSharesChanged}
          folderMutations={{
            onCreate: handleCreateFolder,
            onRename: handleRenameFolder,
            onDelete: handleDeleteFolder,
            onReorder: handleReorderFolders,
            onSetIcon: handleSetFolderIcon,
          }}
          noteMutations={{
            onCreate: handleCreateNote,
            onRename: handleRenameNote,
            onDuplicate: handleDuplicateNote,
            onMove: handleMoveNote,
            onDelete: handleDeleteNote,
          }}
        />
      </div>
      <main className="relative flex flex-col px-6 py-6 xl:px-12 xl:py-10">
        {sidebarCollapsed ? (
          <button
            type="button"
            aria-label={t('expandSidebar')}
            title={t('expandSidebar')}
            onClick={toggleSidebar}
            className="text-muted-foreground/60 hover:text-foreground absolute left-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded text-sm leading-none"
          >
            <span aria-hidden="true">»</span>
          </button>
        ) : null}
        <div className="absolute right-3 top-3 z-10">
          <UserMenu user={user} />
        </div>
        {noteDetail ? (
          <>
            <EditableNoteTitle
              title={noteDetail.title}
              onCommit={(title) => {
                void handleRenameNote(noteDetail.id, title);
              }}
            />
            <NoteEditor
              key={noteDetail.id}
              noteId={noteDetail.id}
              initialTitle={noteDetail.title}
              initialBody={noteDetail.body}
              initialBodyVersion={noteDetail.bodyVersion}
              titleManuallySet={noteDetail.titleManuallySet}
              currentUser={currentUser}
              onTitleChange={(title) => {
                setNoteDetail((prev) => (prev ? { ...prev, title } : prev));
                setNotes((prev) => prev.map((n) => (n.id === noteDetail.id ? { ...n, title } : n)));
              }}
              noteTags={noteDetail.tags}
              allTags={tags}
              onTagsChange={handleSetNoteTags}
              onCreateTag={handleCreateTag}
            />
          </>
        ) : (
          <div className="text-muted-foreground flex flex-1 items-center justify-center">
            <div className="max-w-md text-center">
              <h2 className="font-display text-foreground mb-2 text-2xl">{t('welcome')}</h2>
              <p className="text-muted-foreground">{t('emptyHint')}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
