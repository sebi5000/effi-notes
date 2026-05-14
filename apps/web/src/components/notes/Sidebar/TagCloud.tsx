'use client';

import type { TagItem } from '@/lib/api/schemas.ts';

type Props = {
  tags: ReadonlyArray<TagItem>;
  selectedId: string | null;
  onToggle: (id: string | null) => void;
};

export function TagCloud({ tags, selectedId, onToggle }: Props) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const isSelected = tag.id === selectedId;
        return (
          <li key={tag.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(isSelected ? null : tag.id)}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                isSelected
                  ? 'bg-accent text-white'
                  : 'bg-muted text-muted-foreground hover:bg-paper-line'
              }`}
            >
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tag.color ?? 'currentColor' }}
              />
              <span>{tag.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
