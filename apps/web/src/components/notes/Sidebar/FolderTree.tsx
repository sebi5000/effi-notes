'use client';

import { useTranslations } from 'next-intl';
import { type DragEvent, type KeyboardEvent, useMemo, useState } from 'react';
import type { FolderNode } from '@/lib/api/schemas.ts';
import {
  buildFolderTree,
  computeReorder,
  computeRootReorder,
  type DropMode,
  type FlatFolder,
  flatten,
  isDescendant,
  isNoopReorder,
  moveSelection,
  resolveDropMode,
} from '@/lib/notes/folder-tree.ts';

export type FolderMutationHandlers = {
  /** Rename `id` to `name`. Should reject with throw on failure. */
  onRename: (id: string, name: string) => Promise<void>;
  /** Delete `id`. Throws on 409 (non-empty) or other errors. */
  onDelete: (id: string) => Promise<void>;
  /**
   * Persist a drag-and-drop result: every id in `orderedIds` becomes a
   * child of `parentId` (null = root) at its array index. When omitted,
   * drag-and-drop is disabled.
   */
  onReorder?: (parentId: string | null, orderedIds: string[]) => Promise<void>;
};

type Props = {
  folders: ReadonlyArray<FolderNode>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Optional mutation surface — when provided, hover-reveals rename/delete + DnD if `onReorder` is set. */
  mutations?: FolderMutationHandlers;
};

const DND_MIME = 'application/x-effi-folder';

/** Active drop target while dragging — a row + which third the pointer is over. */
type DropTarget = { id: string; mode: DropMode } | { id: '__root__'; mode: 'inside' };

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
 * Drag-and-drop (when `mutations.onReorder` is set): each row is draggable.
 * The drop lands in one of three zones of the hovered row —
 *   - top quarter    → drop *before* it (same level, reorder)
 *   - middle half    → drop *inside* it (nest as a child)
 *   - bottom quarter → drop *after* it (same level, reorder)
 * Dropping on the root zone moves the folder to the top level. A folder
 * dropped *inside* a target auto-expands that target so it doesn't appear
 * to vanish. Cycle drops (into your own subtree) are rejected.
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
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

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

  const expand = (id: string) => {
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
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

  const dndEnabled = mutations?.onReorder !== undefined;

  /** Resolve + persist a drop. Returns once the reorder (if any) has run. */
  const applyDrop = async (draggedId: string, target: DropTarget): Promise<void> => {
    if (!mutations?.onReorder) return;
    const plan =
      target.id === '__root__'
        ? computeRootReorder(folders, draggedId)
        : computeReorder(folders, draggedId, target.id, target.mode);
    if (plan === null) {
      // Only an in-subtree drop reaches here as a hard reject (the dragOver
      // guard blocks the rest) — surface the cycle reason.
      setActionError(t('cycle'));
      return;
    }
    if (isNoopReorder(folders, plan)) return;
    // Optimistically reveal the destination so a nested folder isn't hidden
    // behind a collapsed parent after the refresh.
    if (target.id !== '__root__' && target.mode === 'inside') {
      expand(target.id);
    }
    try {
      await mutations.onReorder(plan.parentId, plan.orderedIds);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'move failed');
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

  const onRowDragStart = (id: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    e.dataTransfer.setData(DND_MIME, id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
  };

  const onRowDragOver = (id: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled || draggingId === null) return;
    // A row inside the dragged folder's own subtree (or the row itself) can
    // never be a legal drop target — skip it entirely.
    if (isDescendant(folders, draggingId, id)) return;
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const mode = resolveDropMode(e.currentTarget.getBoundingClientRect(), e.clientY);
    setDropTarget((prev) =>
      prev !== null && prev.id === id && prev.mode === mode ? prev : { id, mode },
    );
  };

  const onRowDragLeave = (id: string) => () => {
    setDropTarget((prev) => (prev !== null && prev.id === id ? null : prev));
  };

  const onRowDrop = (id: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    e.stopPropagation();
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DND_MIME) || draggingId;
    const mode =
      dropTarget !== null && dropTarget.id === id
        ? dropTarget.mode
        : resolveDropMode(e.currentTarget.getBoundingClientRect(), e.clientY);
    setDraggingId(null);
    setDropTarget(null);
    if (!draggedId || isDescendant(folders, draggedId, id)) return;
    void applyDrop(draggedId, { id, mode });
  };

  const onRootDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled || draggingId === null) return;
    const dragged = folders.find((f) => f.id === draggingId);
    if (!dragged || dragged.parentId === null) return; // already at root
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget((prev) =>
      prev !== null && prev.id === '__root__' ? prev : { id: '__root__', mode: 'inside' },
    );
  };

  const onRootDragLeave = () => {
    setDropTarget((prev) => (prev !== null && prev.id === '__root__' ? null : prev));
  };

  const onRootDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DND_MIME) || draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!draggedId) return;
    void applyDrop(draggedId, { id: '__root__', mode: 'inside' });
  };

  const onAnyDragEnd = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 DnD drop-zone, not a click/keyboard control; the accessible surface is the keyboard-navigable tree below
    <div
      data-testid="folder-tree-root"
      onDragOver={dndEnabled ? onRootDragOver : undefined}
      onDragLeave={dndEnabled ? onRootDragLeave : undefined}
      onDrop={dndEnabled ? onRootDrop : undefined}
      className={
        dropTarget?.id === '__root__'
          ? 'ring-accent rounded ring-2 ring-inset transition'
          : undefined
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
            dropMode={dropTarget !== null && dropTarget.id === row.id ? dropTarget.mode : null}
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
  /** Non-null while this row is the active drop target. */
  dropMode: DropMode | null;
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

/** before/after → an inset accent line at the top/bottom edge (no layout shift). */
const dropShadow: Record<DropMode, string | undefined> = {
  before: 'inset 0 2px 0 0 var(--color-accent)',
  after: 'inset 0 -2px 0 0 var(--color-accent)',
  inside: undefined,
};

function FolderRow({
  row,
  isExpanded,
  isSelected,
  isRenaming,
  isDragging,
  dropMode,
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
      data-drop-mode={dropMode ?? undefined}
      style={{
        paddingLeft: `${row.depth * 14 + 8}px`,
        ...(dropMode !== null ? { boxShadow: dropShadow[dropMode] } : {}),
      }}
      className={`hover:bg-muted/60 group flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-sm transition-colors ${
        isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground'
      } ${isDragging ? 'opacity-50' : ''} ${
        dropMode === 'inside' ? 'bg-accent-soft/40 ring-accent ring-1' : ''
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
