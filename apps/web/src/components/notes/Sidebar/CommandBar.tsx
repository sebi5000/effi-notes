'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { FolderNode, SearchHit, TagItem } from '@/lib/api/schemas.ts';
import { searchApi } from '@/lib/notes/api-client.ts';
import { filterTags, parseCommand } from '@/lib/notes/command.ts';
import { debounce } from '@/lib/notes/debounce.ts';
import { filterFolderPaths, folderPath } from '@/lib/notes/folder-tree.ts';

type Props = {
  /** Current query string — controlled by the parent (URL `?q=`). */
  value: string;
  /** Reports the next query string on every change. */
  onChange: (next: string) => void;
  /** Opens a note — used when a text-search hit is chosen. */
  onSelect: (noteId: string) => void;
  /** Folder list — resolves `/path` suggestions. Empty by default. */
  folders?: ReadonlyArray<FolderNode>;
  /** Tag dictionary — resolves `#name` suggestions. Empty by default. */
  tags?: ReadonlyArray<TagItem>;
  /** Test seam: injection point for the search fn. Defaults to searchApi.query. */
  search?: (q: string) => Promise<{ hits: SearchHit[]; total: number }>;
  debounceMs?: number;
};

/**
 * Controlled search/command input. The query string is the single source of
 * truth for the notes filter (the parent persists it in the URL). Parsing
 * decides between four modes:
 *   - empty            → no filter
 *   - `#…`             → tag-suggestion dropdown
 *   - `/…`             → folder-suggestion dropdown
 *   - anything else    → free-text note search via /api/search
 *
 * Selecting a tag or folder writes its canonical `#name` / `/path` back into
 * the value; selecting a search hit calls `onSelect`. The suggestion dropdown
 * is shown only while the user is actively typing — picking a suggestion,
 * opening a note, or pressing Escape closes it.
 */
export function CommandBar({
  value,
  onChange,
  onSelect,
  folders = [],
  tags = [],
  search,
  debounceMs = 200,
}: Props) {
  const t = useTranslations('notes.commandBar');
  const [hits, setHits] = useState<ReadonlyArray<SearchHit>>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const parsed = useMemo(() => parseCommand(value), [value]);
  const tagMatches = useMemo(
    () => (parsed.kind === 'tag' ? filterTags(tags, parsed.needle) : []),
    [parsed, tags],
  );
  const folderMatches = useMemo(
    () => (parsed.kind === 'folder' ? filterFolderPaths(folders, parsed.path) : []),
    [parsed, folders],
  );

  const fn = search ?? ((qq: string) => searchApi.query(qq));

  const run = useMemo(
    () =>
      debounce(async (val: string) => {
        const p = parseCommand(val);
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

  const change = (next: string) => {
    onChange(next);
    setOpen(true);
    run(next);
  };

  const applyTag = (tag: TagItem) => {
    onChange(`#${tag.name}`);
    setHits([]);
    setOpen(false);
  };

  const applyFolder = (folder: FolderNode) => {
    onChange(`/${folderPath(folders, folder.id)}`);
    setHits([]);
    setOpen(false);
  };

  const openHit = (id: string) => {
    onSelect(id);
    setHits([]);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setHits([]);
    setOpen(false);
    run.cancel();
  };

  const showTagList = open && parsed.kind === 'tag';
  const showFolderList = open && parsed.kind === 'folder';
  const showHits = open && parsed.kind === 'text' && hits.length > 0;

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
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (e.key !== 'Enter') return;
          if (parsed.kind === 'tag' && tagMatches[0]) {
            e.preventDefault();
            applyTag(tagMatches[0]);
            return;
          }
          if (parsed.kind === 'folder' && folderMatches[0]) {
            e.preventDefault();
            applyFolder(folderMatches[0]);
            return;
          }
          if (parsed.kind === 'text' && hits[0]) {
            e.preventDefault();
            openHit(hits[0].id);
          }
        }}
        className="border-border bg-background placeholder:text-muted-foreground/70 focus:border-accent focus:ring-accent w-full rounded border py-1.5 pl-3 pr-8 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2"
      />
      {value.length > 0 ? (
        <button
          type="button"
          aria-label={t('clearSearch')}
          title={t('clearSearch')}
          onClick={clear}
          className="text-muted-foreground/60 hover:text-foreground absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center text-sm leading-none"
        >
          ×
        </button>
      ) : null}
      <span className="text-muted-foreground/60 mt-1 block px-1 text-[10px] leading-tight">
        {t('hint')}
      </span>
      {busy ? (
        <span className="text-muted-foreground absolute right-7 top-2 text-xs">…</span>
      ) : null}

      {showTagList ? (
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
                  onClick={() => applyTag(tag)}
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
      ) : showFolderList ? (
        <ul
          aria-label="Folder suggestions"
          className="border-border bg-background absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border shadow-md"
        >
          {folderMatches.length === 0 ? (
            <li className="text-muted-foreground/70 px-3 py-2 text-xs italic">
              {t('noFolderMatch')}
            </li>
          ) : (
            folderMatches.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  onClick={() => applyFolder(folder)}
                  className="hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <span aria-hidden="true" className="text-muted-foreground/60 text-[10px]">
                    ▸
                  </span>
                  <span className="font-display">/{folderPath(folders, folder.id)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : showHits ? (
        <ul
          aria-label="Search results"
          className="border-border bg-background absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border shadow-md"
        >
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => openHit(hit.id)}
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
