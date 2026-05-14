'use client';

import { useTranslations } from 'next-intl';
import type { FolderNode, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { CommandBar } from './CommandBar.tsx';
import { FolderTree } from './FolderTree.tsx';
import { TagCloud } from './TagCloud.tsx';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  notes: ReadonlyArray<NoteListItem>;
  selectedFolderId: string | null;
  selectedTagId: string | null;
  selectedNoteId: string | null;
  onSelectFolder: (id: string | null) => void;
  onSelectTag: (id: string | null) => void;
  onSelectNote: (id: string) => void;
};

export function Sidebar({
  folders,
  tags,
  notes,
  selectedFolderId,
  selectedTagId,
  selectedNoteId,
  onSelectFolder,
  onSelectTag,
  onSelectNote,
}: Props) {
  const t = useTranslations('notes.sidebar');
  return (
    <aside className="border-paper-line/80 flex h-full flex-col gap-4 border-r p-4">
      <header className="flex items-center gap-2">
        <span className="font-display text-foreground text-lg font-semibold tracking-tight">
          effi · notes
        </span>
      </header>

      <CommandBar onSelect={onSelectNote} />

      <section aria-label={t('foldersHeading')} className="flex-1 overflow-y-auto">
        <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
          {t('foldersHeading')}
        </h3>
        <FolderTree folders={folders} selectedId={selectedFolderId} onSelect={onSelectFolder} />

        <h3 className="text-muted-foreground mb-1 mt-4 text-xs font-medium uppercase tracking-wide">
          {t('tagsHeading')}
        </h3>
        <TagCloud tags={tags} selectedId={selectedTagId} onToggle={onSelectTag} />

        <h3 className="text-muted-foreground mb-1 mt-4 text-xs font-medium uppercase tracking-wide">
          {t('notesHeading')}
        </h3>
        <ul aria-label={t('notesHeading')} className="space-y-0.5">
          {notes.length === 0 ? (
            <li className="text-muted-foreground/70 px-2 py-1 text-sm italic">{t('emptyState')}</li>
          ) : (
            notes.map((n) => {
              const isSel = n.id === selectedNoteId;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNote(n.id)}
                    aria-current={isSel ? 'true' : undefined}
                    className={`hover:bg-muted/60 block w-full rounded px-2 py-1 text-left text-sm ${
                      isSel ? 'bg-muted text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    <div className="font-display truncate">{n.title}</div>
                    {n.tags.length > 0 ? (
                      <div className="text-muted-foreground/70 mt-0.5 flex gap-1 text-[10px]">
                        {n.tags.slice(0, 3).map((tag) => (
                          <span key={tag.id}>#{tag.name}</span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </aside>
  );
}
