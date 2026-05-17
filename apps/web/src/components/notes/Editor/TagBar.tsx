'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { TagItem } from '@/lib/api/schemas.ts';
import { filterTags } from '@/lib/notes/command.ts';
import { tagColor } from '@/lib/notes/tag-color.ts';

type Props = {
  /** The current note's tags. */
  tags: ReadonlyArray<TagItem>;
  /** The full tag dictionary, for autocomplete. */
  allTags: ReadonlyArray<TagItem>;
  /** Replace the note's tags with `tagIds`. Rejects on failure. */
  onChange: (tagIds: string[]) => Promise<void>;
  /** Create (idempotent) a tag and return it. */
  onCreateTag: (name: string) => Promise<TagItem>;
};

/**
 * The note editor's tag bar — chips for the note's tags plus an autocomplete
 * control to add an existing tag or create a new one. Sits between the
 * editor meta-bar and the editing surface.
 */
export function TagBar({ tags, allTags, onChange, onCreateTag }: Props) {
  const t = useTranslations('notes.tagBar');
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (error === null) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const currentIds = tags.map((tg) => tg.id);
  const attached = new Set(currentIds);
  const needle = input.trim();
  const matches = (needle.length > 0 ? filterTags(allTags, needle) : []).filter(
    (tg) => !attached.has(tg.id),
  );
  const exactExists = allTags.some((tg) => tg.name.toLowerCase() === needle.toLowerCase());
  const canCreate = needle.length > 0 && !exactExists;

  const run = (fn: () => Promise<void>): void => {
    void (async () => {
      try {
        await fn();
        setError(null);
        setAdding(false);
        setInput('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'tag update failed');
      }
    })();
  };

  const remove = (id: string) => run(() => onChange(currentIds.filter((x) => x !== id)));
  const addExisting = (id: string) => run(() => onChange([...currentIds, id]));
  const create = () =>
    run(async () => {
      const tag = await onCreateTag(needle);
      await onChange([...currentIds, tag.id]);
    });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {tags.map((tg) => {
        const color = tg.color ?? tagColor(tg.name);
        return (
          <span
            key={tg.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{ backgroundColor: `${color}22`, color }}
          >
            <span className="font-display">#{tg.name}</span>
            <button
              type="button"
              aria-label={t('removeTag', { name: tg.name })}
              onClick={() => remove(tg.id)}
              className="opacity-60 transition-opacity hover:opacity-100"
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        );
      })}

      {adding ? (
        <span className="relative">
          <input
            ref={(el) => {
              if (el) el.focus();
            }}
            aria-label={t('addTag')}
            value={input}
            placeholder={t('placeholder')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false);
                setInput('');
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (matches[0]) addExisting(matches[0].id);
                else if (canCreate) create();
              }
            }}
            onBlur={() => setAdding(false)}
            className="border-border bg-background w-32 rounded border px-1.5 py-0.5 text-xs focus:outline-none"
          />
          {needle.length > 0 ? (
            <ul className="border-border bg-background absolute z-10 mt-1 max-h-60 w-48 overflow-y-auto rounded border shadow-md">
              {matches.map((tg) => (
                <li key={tg.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addExisting(tg.id)}
                    className="hover:bg-muted block w-full px-2 py-1 text-left text-xs"
                  >
                    #{tg.name}
                  </button>
                </li>
              ))}
              {canCreate ? (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => create()}
                    className="hover:bg-muted block w-full px-2 py-1 text-left text-xs"
                  >
                    {t('createTag', { name: needle })}
                  </button>
                </li>
              ) : null}
              {matches.length === 0 && !canCreate ? (
                <li className="text-muted-foreground/70 px-2 py-1 text-xs italic">
                  {t('noMatches')}
                </li>
              ) : null}
            </ul>
          ) : null}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-muted-foreground/70 hover:text-foreground rounded border border-dashed px-2 py-0.5 text-xs"
        >
          + {t('addTag')}
        </button>
      )}

      {error !== null ? (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      ) : null}
    </div>
  );
}
