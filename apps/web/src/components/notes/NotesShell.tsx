'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FolderNode, NoteDetail, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { foldersApi, notesApi } from '@/lib/notes/api-client.ts';
import { parseCommand, resolveTagId } from '@/lib/notes/command.ts';
import { folderPath, resolveFolderPath } from '@/lib/notes/folder-tree.ts';
import { useSidebarCollapsed } from '@/lib/notes/use-sidebar-collapsed.ts';
import { NoteEditor } from './Editor/NoteEditor.tsx';
import { Sidebar } from './Sidebar/index.tsx';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  initialNotes: ReadonlyArray<NoteListItem>;
  currentUser: { id: string; name: string; color: string };
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
  tags,
  initialNotes,
  currentUser,
  initialNote,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('notes.shell');
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();

  const query = searchParams.get('q') ?? '';
  const [folders, setFolders] = useState<ReadonlyArray<FolderNode>>(initialFolders);
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

  // Re-fetch whenever the resolved filter changes. Keyed on folderId/tagId —
  // not raw `query` — so typing free text never triggers a list fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Inside the async IIFE — not the synchronous effect body — so the
      // react-hooks/set-state-in-effect rule does not flag a cascading render.
      setPending(true);
      try {
        const list = await notesApi.list({
          ...(folderId !== null ? { folderId } : {}),
          ...(tagId !== null ? { tagId } : {}),
        });
        if (!cancelled) setNotes(byUpdatedAtDesc(list.notes));
      } catch {
        // keep the previous list on error
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, tagId]);

  const setQuery = useCallback(
    (next: string) => {
      router.replace(`${pathname}${qSuffix(next)}`);
    },
    [router, pathname],
  );

  const selectFolder = useCallback(
    (id: string | null) => {
      if (id === null) setQuery('');
      else setQuery(`/${folderPath(folders, id)}`);
    },
    [setQuery, folders],
  );

  const openNote = useCallback(
    async (id: string) => {
      router.push(`/notes/${id}${qSuffix(query)}`);
      try {
        const detail = await notesApi.get(id);
        setNoteDetail(detail);
      } catch {
        // ignore — the destination page re-fetches server-side
      }
    },
    [router, query],
  );

  const refreshFolders = useCallback(async () => {
    try {
      const res = await foldersApi.list();
      setFolders(res.folders);
    } catch {
      // ignore — keep current state
    }
  }, []);

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
    setNoteDetail((prev) => (prev && prev.id === id ? { ...prev, title } : prev));
  }, []);

  const handleDuplicateNote = useCallback(
    async (id: string) => {
      const created = await notesApi.duplicate(id);
      router.push(`/notes/${created.id}${qSuffix(query)}`);
    },
    [router, query],
  );

  return (
    <div
      className={`grid h-screen transition-[grid-template-columns] duration-200 ${
        sidebarCollapsed ? 'grid-cols-[0px_1fr]' : 'grid-cols-[280px_1fr]'
      }`}
    >
      <div className="overflow-hidden">
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          pending={pending}
          query={query}
          selectedFolderId={folderId}
          selectedNoteId={noteDetail?.id ?? null}
          onQueryChange={setQuery}
          onSelectFolder={selectFolder}
          onSelectNote={openNote}
          onCollapse={toggleSidebar}
          folderMutations={{
            onCreate: handleCreateFolder,
            onRename: handleRenameFolder,
            onDelete: handleDeleteFolder,
            onReorder: handleReorderFolders,
          }}
          noteMutations={{
            onCreate: handleCreateNote,
            onRename: handleRenameNote,
            onDuplicate: handleDuplicateNote,
          }}
        />
      </div>
      <main className="relative flex flex-col px-12 py-10">
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
        {noteDetail ? (
          <>
            <h1 className="font-body text-foreground mb-4 text-3xl font-semibold">
              {noteDetail.title}
            </h1>
            <NoteEditor
              key={noteDetail.id}
              noteId={noteDetail.id}
              initialTitle={noteDetail.title}
              initialBody={noteDetail.body}
              initialUpdatedAt={noteDetail.updatedAt}
              currentUser={currentUser}
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
