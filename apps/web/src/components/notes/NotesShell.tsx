'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { FolderNode, NoteDetail, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { foldersApi, notesApi } from '@/lib/notes/api-client.ts';
import { NoteEditor } from './Editor/NoteEditor.tsx';
import { Sidebar } from './Sidebar/index.tsx';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  initialNotes: ReadonlyArray<NoteListItem>;
  currentUser: { id: string; name: string; color: string };
  initialNote: NoteDetail | null;
};

export function NotesShell({
  folders: initialFolders,
  tags,
  initialNotes,
  currentUser,
  initialNote,
}: Props) {
  const router = useRouter();
  const t = useTranslations('notes.shell');
  const [folders, setFolders] = useState<ReadonlyArray<FolderNode>>(initialFolders);
  const [notes, setNotes] = useState<ReadonlyArray<NoteListItem>>(initialNotes);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [noteDetail, setNoteDetail] = useState<NoteDetail | null>(initialNote);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await notesApi.list({
          ...(folderId !== null ? { folderId } : {}),
          ...(tagId !== null ? { tagId } : {}),
        });
        if (!cancelled) setNotes(list.notes);
      } catch {
        // keep previous list on error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, tagId]);

  const openNote = async (id: string) => {
    router.push(`/notes/${id}`);
    try {
      const detail = await notesApi.get(id);
      setNoteDetail(detail);
    } catch {
      // ignore
    }
  };

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
      if (folderId === id) setFolderId(null);
    },
    [refreshFolders, folderId],
  );

  const handleReorderFolders = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      // One transaction-backed call handles both same-level reordering and
      // cross-hierarchy moves: every id becomes a child of `parentId` at its
      // array index.
      await foldersApi.reorder(parentId, orderedIds);
      await refreshFolders();
    },
    [refreshFolders],
  );

  return (
    <div className="grid h-screen grid-cols-[280px_1fr]">
      <Sidebar
        folders={folders}
        tags={tags}
        notes={notes}
        selectedFolderId={folderId}
        selectedTagId={tagId}
        selectedNoteId={noteDetail?.id ?? null}
        onSelectFolder={setFolderId}
        onSelectTag={setTagId}
        onSelectNote={openNote}
        folderMutations={{
          onCreate: handleCreateFolder,
          onRename: handleRenameFolder,
          onDelete: handleDeleteFolder,
          onReorder: handleReorderFolders,
        }}
      />
      <main className="flex flex-col px-12 py-10">
        {noteDetail ? (
          <>
            <h1 className="font-display text-foreground mb-4 text-3xl font-semibold">
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
