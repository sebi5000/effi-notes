'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { SearchHit } from '@/lib/api/schemas.ts';
import { searchApi } from '@/lib/notes/api-client.ts';
import { debounce } from '@/lib/notes/debounce.ts';

type Props = {
  onSelect: (noteId: string) => void;
  /** Test seam: injection point for the search fn. Defaults to searchApi.query. */
  search?: (q: string) => Promise<{ hits: SearchHit[]; total: number }>;
  debounceMs?: number;
};

export function CommandBar({ onSelect, search, debounceMs = 200 }: Props) {
  const t = useTranslations('notes.commandBar');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ReadonlyArray<SearchHit>>([]);
  const [busy, setBusy] = useState(false);

  const fn = search ?? ((qq: string) => searchApi.query(qq));

  const run = useMemo(
    () =>
      debounce(async (value: string) => {
        if (value.trim().length === 0) {
          setHits([]);
          return;
        }
        try {
          setBusy(true);
          const res = await fn(value);
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
          if (e.key === 'Enter' && hits.length > 0 && hits[0]) {
            e.preventDefault();
            onSelect(hits[0].id);
            setQ('');
            setHits([]);
          }
        }}
        className="border-border bg-background placeholder:text-muted-foreground/70 focus:border-accent focus:ring-accent w-full rounded border px-3 py-1.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2"
      />
      {busy ? (
        <span className="text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 text-xs">
          …
        </span>
      ) : null}
      {hits.length > 0 ? (
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
