'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { FolderNode, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { CommandBar } from './CommandBar.tsx';
import { type FolderMutationHandlers, FolderTree } from './FolderTree.tsx';

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
  folderMutations?: FolderMutationHandlers & {
    onCreate: (name: string, parentId: string | null) => Promise<void>;
    onMove?: (id: string, parentId: string | null) => Promise<void>;
  };
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
  folderMutations,
}: Props) {
  const t = useTranslations('notes.sidebar');
  const tA = useTranslations('notes.folderActions');
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const activeTag = useMemo(
    () => tags.find((tg) => tg.id === selectedTagId) ?? null,
    [tags, selectedTagId],
  );

  const submitCreate = async () => {
    if (!folderMutations) return;
    const name = createName.trim();
    if (name.length === 0) {
      setCreating(false);
      setCreateName('');
      return;
    }
    try {
      await folderMutations.onCreate(name, selectedFolderId);
      setCreating(false);
      setCreateName('');
      setCreateError(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'create failed');
    }
  };

  return (
    <aside className="border-paper-line/80 flex h-full flex-col gap-4 border-r p-4">
      <header className="flex items-center gap-2">
        <span className="font-display text-foreground text-lg font-semibold tracking-tight">
          effi · notes
        </span>
      </header>

      <CommandBar onSelect={onSelectNote} onTagSelect={onSelectTag} tags={tags} />

      {activeTag !== null ? (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">{t('filterByTag')}</span>
          <button
            type="button"
            onClick={() => onSelectTag(null)}
            className="bg-accent inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-white"
          >
            <span>#{activeTag.name}</span>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      <section aria-label={t('foldersHeading')} className="flex-1 overflow-y-auto">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {t('foldersHeading')}
          </h3>
          {folderMutations ? (
            <button
              type="button"
              aria-label={tA('newFolder')}
              title={tA('newFolder')}
              onClick={() => setCreating(true)}
              className="text-muted-foreground/70 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-sm leading-none"
            >
              +
            </button>
          ) : null}
        </div>

        {creating && folderMutations ? (
          <div className="mb-1 flex items-center gap-1 px-2 py-1">
            <span aria-hidden="true" className="inline-block h-4 w-4" />
            <input
              ref={(el) => {
                if (el) el.focus();
              }}
              aria-label={tA('newFolder')}
              value={createName}
              placeholder={tA('newFolderPlaceholder')}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitCreate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setCreating(false);
                  setCreateName('');
                }
              }}
              onBlur={() => void submitCreate()}
              className="border-border bg-background font-display flex-1 rounded border px-1 py-0.5 text-sm focus:outline-none"
            />
          </div>
        ) : null}

        <FolderTree
          folders={folders}
          selectedId={selectedFolderId}
          onSelect={onSelectFolder}
          {...(folderMutations
            ? {
                mutations: {
                  onRename: folderMutations.onRename,
                  onDelete: folderMutations.onDelete,
                  ...(folderMutations.onMove ? { onMove: folderMutations.onMove } : {}),
                },
              }
            : {})}
        />

        {createError !== null ? (
          <div role="alert" className="text-danger mt-2 rounded bg-red-50 px-2 py-1 text-xs">
            {createError}
          </div>
        ) : null}

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
