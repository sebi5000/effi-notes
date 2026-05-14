'use client';

import { type KeyboardEvent, useMemo, useState } from 'react';
import type { FolderNode } from '@/lib/api/schemas.ts';
import {
  buildFolderTree,
  type FlatFolder,
  flatten,
  moveSelection,
} from '@/lib/notes/folder-tree.ts';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * Accessible folder tree. Uses ARIA tree pattern: container has role="tree",
 * each row has role="treeitem" + aria-level + aria-expanded. Keyboard:
 *   ↓/↑   move selection
 *   →     expand collapsed node
 *   ←     collapse expanded node (or move to parent)
 *   Enter / Space  activate
 *
 * Stateless w.r.t. data — `folders` flows in. Expansion is component-local
 * because the sidebar should remember which rows you opened across re-renders.
 */
export function FolderTree({ folders, selectedId, onSelect }: Props) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    // By default expand the roots so users see the tree.
    const roots = new Set<string>();
    for (const f of folders) {
      if (f.parentId === null) roots.add(f.id);
    }
    return roots;
  });

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

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = visible.find((r) => r.id === selectedId);
    if (!row) {
      // No row selected yet — Down moves to the first.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = moveSelection(visible, null, 'down');
        if (next !== null) onSelect(next);
      }
      return;
    }
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
        if (row.hasChildren && !expanded.has(row.id)) {
          toggle(row.id);
        }
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (row.hasChildren && expanded.has(row.id)) {
          toggle(row.id);
          return;
        }
        if (row.parentId) {
          onSelect(row.parentId);
        }
        return;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (row.hasChildren) toggle(row.id);
        return;
      }
      default:
        return;
    }
  };

  return (
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
          onSelect={onSelect}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

function FolderRow({
  row,
  isExpanded,
  isSelected,
  onSelect,
  onToggle,
}: {
  row: FlatFolder;
  isExpanded: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      role="treeitem"
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      aria-expanded={row.hasChildren ? isExpanded : undefined}
      data-id={row.id}
      style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
      className={`hover:bg-muted/60 group flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-sm transition-colors ${
        isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground'
      }`}
      onClick={() => onSelect(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
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
      <span className="font-display truncate">{row.name}</span>
    </div>
  );
}
