'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FolderNode, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { NOTE_DND_MIME } from '@/lib/notes/dnd.ts';
import { ShareDialog } from '../Share/ShareDialog.tsx';
import { CommandBar } from './CommandBar.tsx';
import { type FolderMutationHandlers, FolderTree } from './FolderTree.tsx';

type ShareTarget = { kind: 'note' | 'folder'; id: string };

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  notes: ReadonlyArray<NoteListItem>;
  /** True while the filtered notes list is being fetched. */
  pending?: boolean;
  /** Current command-bar query — the single source of truth for the filter. */
  query: string;
  selectedFolderId: string | null;
  selectedNoteId: string | null;
  onQueryChange: (next: string) => void;
  onSelectFolder: (id: string | null) => void;
  onSelectNote: (id: string) => void;
  folderMutations?: FolderMutationHandlers & {
    onCreate: (name: string, parentId: string | null) => Promise<void>;
  };
  noteMutations?: {
    onCreate: () => Promise<void>;
    onRename: (id: string, title: string) => Promise<void>;
    onDuplicate: (id: string) => Promise<void>;
    onMove: (noteId: string, folderId: string | null) => Promise<void>;
  };
  /** When provided, a collapse button is shown in the sidebar header. */
  onCollapse?: () => void;
};

export function Sidebar({
  folders,
  tags,
  notes,
  pending = false,
  query,
  selectedFolderId,
  selectedNoteId,
  onQueryChange,
  onSelectFolder,
  onSelectNote,
  folderMutations,
  noteMutations,
  onCollapse,
}: Props) {
  const t = useTranslations('notes.sidebar');
  const tA = useTranslations('notes.folderActions');
  const tNA = useTranslations('notes.noteActions');
  const tShare = useTranslations('notes.share');
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);

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
    <>
      <aside className="border-paper-line/80 flex h-full min-w-[280px] flex-col gap-4 border-r p-4">
        <header className="flex items-center gap-2">
          <span className="font-display text-foreground text-lg font-semibold tracking-tight">
            effi · notes
          </span>
          {onCollapse ? (
            <button
              type="button"
              aria-label={t('collapseSidebar')}
              title={t('collapseSidebar')}
              onClick={onCollapse}
              className="text-muted-foreground/60 hover:text-foreground ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-sm leading-none"
            >
              <span aria-hidden="true">«</span>
            </button>
          ) : null}
        </header>

        <CommandBar
          value={query}
          onChange={onQueryChange}
          onSelect={onSelectNote}
          folders={folders}
          tags={tags}
        />

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
            onOpenShare={setShareTarget}
            noteDragActive={draggingNoteId !== null}
            {...(noteMutations ? { onNoteDrop: noteMutations.onMove } : {})}
            {...(folderMutations
              ? {
                  mutations: {
                    onRename: folderMutations.onRename,
                    onDelete: folderMutations.onDelete,
                    ...(folderMutations.onReorder ? { onReorder: folderMutations.onReorder } : {}),
                  },
                }
              : {})}
          />

          {createError !== null ? (
            <div role="alert" className="text-danger mt-2 rounded bg-red-50 px-2 py-1 text-xs">
              {createError}
            </div>
          ) : null}

          <div className="mb-1 mt-4 flex items-center justify-between">
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t('notesHeading')}
            </h3>
            {noteMutations ? (
              <button
                type="button"
                aria-label={tNA('newNote')}
                title={tNA('newNote')}
                onClick={() => void noteMutations.onCreate()}
                className="text-muted-foreground/70 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-sm leading-none"
              >
                +
              </button>
            ) : null}
          </div>
          <ul aria-label={t('notesHeading')} className="space-y-0.5">
            {pending && notes.length === 0 ? (
              <li className="text-muted-foreground/70 px-2 py-1 text-sm italic">{t('loading')}</li>
            ) : notes.length === 0 ? (
              <li className="text-muted-foreground/70 px-2 py-1 text-sm italic">
                {t('emptyState')}
              </li>
            ) : (
              notes.map((n) => {
                const isSel = n.id === selectedNoteId;
                const isRenaming = renamingNoteId === n.id;
                return (
                  <li
                    key={n.id}
                    className={`group relative flex items-center ${draggingNoteId === n.id ? 'opacity-50' : ''}`}
                    draggable={noteMutations !== undefined && !isRenaming}
                    onDragStart={(e) => {
                      if (!noteMutations) return;
                      e.dataTransfer.setData(NOTE_DND_MIME, n.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingNoteId(n.id);
                    }}
                    onDragEnd={() => setDraggingNoteId(null)}
                  >
                    {isRenaming ? (
                      <input
                        ref={(el) => {
                          if (el) el.focus();
                        }}
                        aria-label={tNA('renameNote')}
                        value={renameValue}
                        placeholder={tNA('renameNotePlaceholder')}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const trimmed = renameValue.trim();
                            if (trimmed.length > 0 && noteMutations) {
                              void noteMutations.onRename(n.id, trimmed);
                            }
                            setRenamingNoteId(null);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenamingNoteId(null);
                          }
                        }}
                        onBlur={() => setRenamingNoteId(null)}
                        className="border-border bg-background font-display flex-1 rounded border px-1 py-0.5 text-sm focus:outline-none"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelectNote(n.id)}
                          aria-current={isSel ? 'true' : undefined}
                          className={`hover:bg-muted/60 flex-1 rounded px-2 py-1 text-left text-sm ${
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
                        <div className="absolute right-1 flex items-center gap-0.5">
                          {noteMutations ? (
                            <>
                              <button
                                type="button"
                                aria-label={tNA('renameNote')}
                                title={tNA('renameNote')}
                                onClick={() => {
                                  setRenameValue(n.title);
                                  setRenamingNoteId(n.id);
                                }}
                                className="text-muted-foreground/50 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-[10px] opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100"
                              >
                                <span aria-hidden="true">✎</span>
                              </button>
                              <button
                                type="button"
                                aria-label={tNA('duplicateNote')}
                                title={tNA('duplicateNote')}
                                onClick={() => void noteMutations.onDuplicate(n.id)}
                                className="text-muted-foreground/50 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-[10px] opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100"
                              >
                                <span aria-hidden="true">⎘</span>
                              </button>
                            </>
                          ) : null}
                          {n.shareCount > 0 ? (
                            <button
                              type="button"
                              aria-label={tShare('sharedIndicatorLabel')}
                              title={tShare('sharedIndicatorLabel')}
                              onClick={() => setShareTarget({ kind: 'note', id: n.id })}
                              className="text-muted-foreground/50 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-[10px] opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100"
                            >
                              <span aria-hidden="true">👁</span>
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </aside>

      {shareTarget !== null ? (
        // TODO: determine canManage based on ownership; API enforces 403 server-side
        <ShareDialog scope={shareTarget} canManage={true} onClose={() => setShareTarget(null)} />
      ) : null}
    </>
  );
}
