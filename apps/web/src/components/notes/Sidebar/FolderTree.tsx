'use client';

import { useTranslations } from 'next-intl';
import { type DragEvent, type KeyboardEvent, useMemo, useState } from 'react';
import type { FolderNode } from '@/lib/api/schemas.ts';
import {
  buildFolderTree,
  type FlatFolder,
  flatten,
  isDescendant,
  moveSelection,
} from '@/lib/notes/folder-tree.ts';

export type FolderMutationHandlers = {
  /** Rename `id` to `name`. Should reject with throw on failure. */
  onRename: (id: string, name: string) => Promise<void>;
  /** Delete `id`. Throws on 409 (non-empty) or other errors. */
  onDelete: (id: string) => Promise<void>;
  /** Optional: move `id` under `parentId` (null = root). When omitted, DnD is disabled. */
  onMove?: (id: string, parentId: string | null) => Promise<void>;
};

type Props = {
  folders: ReadonlyArray<FolderNode>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Optional mutation surface — when provided, hover-reveals rename/delete + DnD if `onMove` is set. */
  mutations?: FolderMutationHandlers;
};

const DND_MIME = 'application/x-effi-folder';

/**
 * Accessible folder tree. Uses ARIA tree pattern: container has role="tree",
 * each row has role="treeitem" + aria-level + aria-expanded. Keyboard:
 *   ↓/↑   move selection
 *   →     expand collapsed node
 *   ←     collapse expanded node (or move to parent)
 *   Enter / Space  activate
 *   F2    rename (when mutations provided)
 *   Del   delete (when mutations provided)
 *
 * Drag-and-drop: when `mutations.onMove` is supplied, each row becomes
 * draggable. Drop on another row → make it a child of that row. Drop on
 * the root drop-zone → make it a root. A cycle guard rejects drops where
 * the candidate parent is a descendant of the dragged folder.
 */
export function FolderTree({ folders, selectedId, onSelect, mutations }: Props) {
  const t = useTranslations('notes.folderActions');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const roots = new Set<string>();
    for (const f of folders) {
      if (f.parentId === null) roots.add(f.id);
    }
    return roots;
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** Highlighted drop target: a folder id, or `__root__` for the root zone. */
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const visible = useMemo(() => flatten(tree, expanded), [tree, expanded]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitRename = async (id: string, name: string) => {
    if (!mutations) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setRenamingId(null);
      return;
    }
    try {
      await mutations.onRename(id, trimmed);
      setRenamingId(null);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'rename failed');
    }
  };

  const requestDelete = async (id: string, name: string) => {
    if (!mutations) return;
    if (!window.confirm(`Delete folder "${name}"?`)) return;
    try {
      await mutations.onDelete(id);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'delete failed');
    }
  };

  /** Validates a drop, then calls onMove. Returns true iff the move actually fired. */
  const tryMove = async (draggedId: string, newParentId: string | null): Promise<boolean> => {
    if (!mutations?.onMove) return false;
    // No-op: dropping onto the current parent.
    const dragged = folders.find((f) => f.id === draggedId);
    if (!dragged) return false;
    if ((dragged.parentId ?? null) === newParentId) return false;
    // Cycle guard.
    if (newParentId !== null && isDescendant(folders, draggedId, newParentId)) {
      setActionError(t('cycle'));
      return false;
    }
    try {
      await mutations.onMove(draggedId, newParentId);
      setActionError(null);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'move failed');
      return false;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = visible.find((r) => r.id === selectedId);
    if (!row) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = moveSelection(visible, null, 'down');
        if (next !== null) onSelect(next);
      }
      return;
    }
    if (renamingId !== null) return;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        onSelect(moveSelection(visible, row.id, 'down'));
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        onSelect(moveSelection(visible, row.id, 'up'));
        return;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (row.hasChildren && !expanded.has(row.id)) toggle(row.id);
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (row.hasChildren && expanded.has(row.id)) {
          toggle(row.id);
          return;
        }
        if (row.parentId) onSelect(row.parentId);
        return;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (row.hasChildren) toggle(row.id);
        return;
      }
      case 'F2': {
        if (mutations) {
          e.preventDefault();
          setRenamingId(row.id);
        }
        return;
      }
      case 'Delete':
      case 'Backspace': {
        if (mutations) {
          e.preventDefault();
          void requestDelete(row.id, row.name);
        }
        return;
      }
      default:
        return;
    }
  };

  const dndEnabled = mutations?.onMove !== undefined;

  const onRowDragStart = (id: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    e.dataTransfer.setData(DND_MIME, id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
  };

  const onRowDragOver = (id: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled || draggingId === null) return;
    if (draggingId === id) return;
    if (isDescendant(folders, draggingId, id)) return;
    // Stop the event reaching the root drop-zone — a row drop is more
    // specific than "drop to root".
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== id) setDropTargetId(id);
  };

  const onRowDragLeave = (id: string) => () => {
    if (dropTargetId === id) setDropTargetId(null);
  };

  const onRowDrop = (id: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    // Prevent the drop from also bubbling to the root drop-zone handler.
    e.stopPropagation();
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DND_MIME) || draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!draggedId || draggedId === id) return;
    void tryMove(draggedId, id);
  };

  const onRootDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled || draggingId === null) return;
    const dragged = folders.find((f) => f.id === draggingId);
    if (!dragged) return;
    if (dragged.parentId === null) return; // already at root
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== '__root__') setDropTargetId('__root__');
  };

  const onRootDragLeave = () => {
    if (dropTargetId === '__root__') setDropTargetId(null);
  };

  const onRootDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DND_MIME) || draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!draggedId) return;
    void tryMove(draggedId, null);
  };

  const onAnyDragEnd = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 DnD drop-zone, not a click/keyboard control; the accessible surface is the keyboard-navigable tree below
    <div
      data-testid="folder-tree-root"
      onDragOver={dndEnabled ? onRootDragOver : undefined}
      onDragLeave={dndEnabled ? onRootDragLeave : undefined}
      onDrop={dndEnabled ? onRootDrop : undefined}
      className={
        dropTargetId === '__root__' ? 'ring-accent rounded ring-2 ring-inset transition' : undefined
      }
    >
      <div
        role="tree"
        aria-label="Folders"
        tabIndex={0}
        onKeyDown={onKey}
        className="focus-visible:ring-accent focus:outline-none focus-visible:ring-2"
      >
        {visible.map((row) => (
          <FolderRow
            key={row.id}
            row={row}
            isExpanded={expanded.has(row.id)}
            isSelected={row.id === selectedId}
            isRenaming={renamingId === row.id}
            isDragging={draggingId === row.id}
            isDropTarget={dropTargetId === row.id}
            draggable={dndEnabled}
            onDragStart={dndEnabled ? onRowDragStart(row.id) : undefined}
            onDragOver={dndEnabled ? onRowDragOver(row.id) : undefined}
            onDragLeave={dndEnabled ? onRowDragLeave(row.id) : undefined}
            onDrop={dndEnabled ? onRowDrop(row.id) : undefined}
            onDragEnd={dndEnabled ? onAnyDragEnd : undefined}
            onSelect={onSelect}
            onToggle={toggle}
            {...(mutations
              ? {
                  onRequestRename: () => setRenamingId(row.id),
                  onCommitRename: (name: string) => commitRename(row.id, name),
                  onCancelRename: () => setRenamingId(null),
                  onRequestDelete: () => requestDelete(row.id, row.name),
                }
              : {})}
          />
        ))}
      </div>
      {actionError !== null ? (
        <div role="alert" className="text-danger mt-2 rounded bg-red-50 px-2 py-1 text-xs">
          {actionError}
        </div>
      ) : null}
    </div>
  );
}

type RowProps = {
  row: FlatFolder;
  isExpanded: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  draggable: boolean;
  onDragStart?: ((e: DragEvent<HTMLDivElement>) => void) | undefined;
  onDragOver?: ((e: DragEvent<HTMLDivElement>) => void) | undefined;
  onDragLeave?: ((e: DragEvent<HTMLDivElement>) => void) | undefined;
  onDrop?: ((e: DragEvent<HTMLDivElement>) => void) | undefined;
  onDragEnd?: ((e: DragEvent<HTMLDivElement>) => void) | undefined;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRequestRename?: (() => void) | undefined;
  onCommitRename?: ((name: string) => void) | undefined;
  onCancelRename?: (() => void) | undefined;
  onRequestDelete?: (() => void) | undefined;
};

function FolderRow({
  row,
  isExpanded,
  isSelected,
  isRenaming,
  isDragging,
  isDropTarget,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onSelect,
  onToggle,
  onRequestRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
}: RowProps) {
  const t = useTranslations('notes.folderActions');
  return (
    <div
      role="treeitem"
      tabIndex={-1}
      draggable={draggable && !isRenaming}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      aria-expanded={row.hasChildren ? isExpanded : undefined}
      aria-grabbed={isDragging ? 'true' : undefined}
      data-id={row.id}
      data-drop-target={isDropTarget ? 'true' : undefined}
      style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
      className={`hover:bg-muted/60 group flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-sm transition-colors ${
        isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground'
      } ${isDragging ? 'opacity-50' : ''} ${
        isDropTarget ? 'bg-accent-soft/40 ring-accent ring-1' : ''
      }`}
      onClick={() => !isRenaming && onSelect(row.id)}
      onKeyDown={(e) => {
        if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
    >
      {row.hasChildren ? (
        <button
          type="button"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(row.id);
          }}
          className="text-muted-foreground/60 hover:text-foreground inline-flex h-4 w-4 items-center justify-center"
        >
          <span aria-hidden="true" className="inline-block text-[10px] leading-none">
            {isExpanded ? '▾' : '▸'}
          </span>
        </button>
      ) : (
        <span aria-hidden="true" className="inline-block h-4 w-4" />
      )}

      {isRenaming && onCommitRename && onCancelRename ? (
        <RenameInput initial={row.name} onCommit={onCommitRename} onCancel={onCancelRename} />
      ) : (
        <span className="font-display flex-1 truncate">{row.name}</span>
      )}

      {!isRenaming && (onRequestRename || onRequestDelete) ? (
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {onRequestRename ? (
            <button
              type="button"
              aria-label={t('rename')}
              title={t('rename')}
              onClick={(e) => {
                e.stopPropagation();
                onRequestRename();
              }}
              className="text-muted-foreground/70 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-[10px]"
            >
              ✎
            </button>
          ) : null}
          {onRequestDelete ? (
            <button
              type="button"
              aria-label={t('delete')}
              title={t('delete')}
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete();
              }}
              className="text-muted-foreground/70 hover:text-danger inline-flex h-5 w-5 items-center justify-center rounded text-[10px]"
            >
              ✕
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      ref={(el) => {
        if (el) {
          el.focus();
          el.select();
        }
      }}
      type="text"
      aria-label="Folder name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      className="border-border bg-background font-display flex-1 rounded border px-1 py-0.5 text-sm focus:outline-none"
    />
  );
}
