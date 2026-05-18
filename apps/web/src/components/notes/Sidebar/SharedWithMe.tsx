'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { FolderNode, NoteListItem, SharedWithMe as Share } from '@/lib/api/schemas.ts';
import { buildFolderTree, type FolderTreeNode } from '@/lib/notes/folder-tree.ts';
import { FolderIcon } from './FolderIcon.tsx';

type Props = {
  /** Shared folder roots and their descendants. */
  sharedFolders: ReadonlyArray<FolderNode>;
  /** Directly-shared notes. */
  sharedNotes: ReadonlyArray<NoteListItem>;
  selectedFolderId: string | null;
  selectedNoteId: string | null;
  onSelectFolder: (id: string) => void;
  onSelectNote: (id: string) => void;
};

/** "Shared by <name> · <access>" attribution line for a shared root. */
function Attribution({ share }: { share: Share }) {
  const t = useTranslations('notes.sharedWithMe');
  return (
    <span className="text-muted-foreground/70">
      {t('sharedBy', { name: share.sharedByName })} ·{' '}
      {t(share.access === 'EDIT' ? 'accessEdit' : 'accessView')}
    </span>
  );
}

/** A small dot marking a not-yet-opened shared resource. */
function UnseenDot() {
  const t = useTranslations('notes.sharedWithMe');
  return (
    <span
      role="img"
      aria-label={t('unseenLabel')}
      className="bg-accent inline-block h-1.5 w-1.5 shrink-0 rounded-full"
    />
  );
}

/**
 * The "Shared with me" sidebar section: a read-only navigable tree of shared
 * folders and a flat list of directly-shared notes, each attributed to the
 * sharer and dotted while unseen. Renders nothing when nothing is shared.
 */
export function SharedWithMe({
  sharedFolders,
  sharedNotes,
  selectedFolderId,
  selectedNoteId,
  onSelectFolder,
  onSelectNote,
}: Props) {
  const t = useTranslations('notes.sharedWithMe');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const tree = useMemo(() => buildFolderTree(sharedFolders), [sharedFolders]);
  const unseen = useMemo(
    () =>
      sharedFolders.filter((f) => f.sharedWithMe?.seenAt === null).length +
      sharedNotes.filter((n) => n.sharedWithMe?.seenAt === null).length,
    [sharedFolders, sharedNotes],
  );

  if (sharedFolders.length === 0 && sharedNotes.length === 0) return null;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: FolderTreeNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.id);
    const isSelected = node.id === selectedFolderId;
    const share = node.sharedWithMe;
    return (
      <li key={node.id}>
        <div
          className={`flex items-center gap-1 rounded text-sm ${
            isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground'
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              aria-label={t(isOpen ? 'collapseFolder' : 'expandFolder')}
              onClick={() => toggle(node.id)}
              className="text-muted-foreground/60 hover:text-foreground inline-flex h-4 w-4 items-center justify-center text-[10px] leading-none"
            >
              <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            </button>
          ) : (
            <span aria-hidden="true" className="inline-block h-4 w-4" />
          )}
          <button
            type="button"
            onClick={() => onSelectFolder(node.id)}
            aria-current={isSelected ? 'true' : undefined}
            className="hover:bg-muted/60 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left"
          >
            <FolderIcon icon={node.icon} className="h-4 w-4 shrink-0" />
            <span className="font-display truncate">{node.name}</span>
            {share?.seenAt === null ? <UnseenDot /> : null}
          </button>
        </div>
        {share !== undefined ? (
          <div
            className="truncate text-[10px] leading-tight"
            style={{ paddingLeft: `${depth * 14 + 30}px` }}
          >
            <Attribution share={share} />
          </div>
        ) : null}
        {isOpen && node.children.length > 0 ? (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <section aria-label={t('heading')} className="mt-4 flex flex-col">
      <h3 className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
        {t('heading')}
        {unseen > 0 ? (
          <span className="bg-accent inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white">
            {unseen}
          </span>
        ) : null}
      </h3>

      {tree.length > 0 ? <ul>{tree.map((node) => renderNode(node, 0))}</ul> : null}

      {sharedNotes.length > 0 ? (
        <ul className="mt-0.5">
          {sharedNotes.map((n) => {
            const isSelected = n.id === selectedNoteId;
            const share = n.sharedWithMe;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelectNote(n.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`hover:bg-muted/60 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
                    isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <span aria-hidden="true" className="text-xs leading-none">
                    📄
                  </span>
                  <span className="font-display truncate">{n.title}</span>
                  {share?.seenAt === null ? <UnseenDot /> : null}
                </button>
                {share !== undefined ? (
                  <div className="truncate pl-9 text-[10px] leading-tight">
                    <Attribution share={share} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
