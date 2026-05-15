'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { SearchHit, TagItem } from '@/lib/api/schemas.ts';
import { searchApi } from '@/lib/notes/api-client.ts';
import { debounce } from '@/lib/notes/debounce.ts';

type Props = {
  onSelect: (noteId: string) => void;
  onTagSelect?: (tagId: string | null) => void;
  /** Tag dictionary used to resolve `#name` lookups. Empty by default. */
  tags?: ReadonlyArray<TagItem>;
  /** Test seam: injection point for the search fn. Defaults to searchApi.query. */
  search?: (q: string) => Promise<{ hits: SearchHit[]; total: number }>;
  debounceMs?: number;
};

/**
 * Parses the input to decide between three modes:
 *   - empty                → nothing
 *   - starts with `#…`     → tag-search (suggestion list of TagItem)
 *   - anything else        → free-text note search via /api/search
 *
 * Exported as a pure function so the routing logic is unit-tested without
 * mounting the component.
 */
export const parseCommand = (
  raw: string,
): { kind: 'empty' } | { kind: 'tag'; needle: string } | { kind: 'text'; q: string } => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  if (trimmed.startsWith('#')) return { kind: 'tag', needle: trimmed.slice(1).toLowerCase() };
  return { kind: 'text', q: trimmed };
};

/**
 * Filters the tag list against the `#needle`. Prefix match wins over
 * substring match so typing `#dis` ranks `discovery` above `playbook-discord`
 * if both exist.
 */
export const filterTags = (
  tags: ReadonlyArray<TagItem>,
  needle: string,
): ReadonlyArray<TagItem> => {
  if (needle.length === 0) return tags;
  const n = needle.toLowerCase();
  const prefix: TagItem[] = [];
  const contains: TagItem[] = [];
  for (const t of tags) {
    const name = t.name.toLowerCase();
    if (name.startsWith(n)) prefix.push(t);
    else if (name.includes(n)) contains.push(t);
  }
  return [...prefix, ...contains];
};

export function CommandBar({ onSelect, onTagSelect, tags = [], search, debounceMs = 200 }: Props) {
  const t = useTranslations('notes.commandBar');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ReadonlyArray<SearchHit>>([]);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseCommand(q), [q]);
  const tagMatches = useMemo(
    () => (parsed.kind === 'tag' ? filterTags(tags, parsed.needle) : []),
    [parsed, tags],
  );

  const fn = search ?? ((qq: string) => searchApi.query(qq));

  const run = useMemo(
    () =>
      debounce(async (value: string) => {
        const p = parseCommand(value);
        if (p.kind !== 'text') {
          setHits([]);
          return;
        }
        try {
          setBusy(true);
          const res = await fn(p.q);
          setHits(res.hits);
        } catch {
          setHits([]);
        } finally {
          setBusy(false);
        }
      }, debounceMs),
    [fn, debounceMs],
  );

  useEffect(() => () => run.cancel(), [run]);

  const applyTag = (tagId: string) => {
    if (onTagSelect) onTagSelect(tagId);
    setQ('');
    setHits([]);
  };

  return (
    <search aria-label="Search notes" className="relative block">
      <label className="sr-only" htmlFor="notes-search">
        {t('label')}
      </label>
      <input
        id="notes-search"
        type="search"
        autoComplete="off"
        placeholder={t('placeholder')}
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          run(v);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (parsed.kind === 'tag' && tagMatches.length > 0 && tagMatches[0]) {
            e.preventDefault();
            applyTag(tagMatches[0].id);
            return;
          }
          if (hits.length > 0 && hits[0]) {
            e.preventDefault();
            onSelect(hits[0].id);
            setQ('');
            setHits([]);
          }
        }}
        className="border-border bg-background placeholder:text-muted-foreground/70 focus:border-accent focus:ring-accent w-full rounded border px-3 py-1.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2"
      />
      <span className="text-muted-foreground/60 mt-1 block px-1 text-[10px] leading-tight">
        {t('hint')}
      </span>
      {busy ? (
        <span className="text-muted-foreground absolute right-2 top-2 text-xs">…</span>
      ) : null}

      {parsed.kind === 'tag' ? (
        <ul
          aria-label="Tag suggestions"
          className="border-border bg-background absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border shadow-md"
        >
          {tagMatches.length === 0 ? (
            <li className="text-muted-foreground/70 px-3 py-2 text-xs italic">{t('noTagMatch')}</li>
          ) : (
            tagMatches.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => applyTag(tag.id)}
                  className="hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color ?? 'currentColor' }}
                  />
                  <span className="font-display">#{tag.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : hits.length > 0 ? (
        <ul
          aria-label="Search results"
          className="border-border bg-background absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border shadow-md"
        >
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(hit.id);
                  setQ('');
                  setHits([]);
                }}
                className="hover:bg-muted block w-full px-3 py-2 text-left text-sm"
              >
                <div className="font-display font-medium">{hit.title}</div>
                {hit.snippet ? (
                  <div
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered ts_headline already-escaped <mark> tags
                    dangerouslySetInnerHTML={{ __html: hit.snippet }}
                    className="text-muted-foreground prose-paper truncate text-xs"
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </search>
  );
}
