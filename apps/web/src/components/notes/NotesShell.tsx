'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { FolderNode, NoteDetail, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { notesApi } from '@/lib/notes/api-client.ts';
import { NoteEditor } from './Editor/NoteEditor.tsx';
import { Sidebar } from './Sidebar/index.tsx';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  initialNotes: ReadonlyArray<NoteListItem>;
  currentUser: { id: string; name: string; color: string };
  initialNote: NoteDetail | null;
};

export function NotesShell({ folders, tags, initialNotes, currentUser, initialNote }: Props) {
  const router = useRouter();
  const t = useTranslations('notes.shell');
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
