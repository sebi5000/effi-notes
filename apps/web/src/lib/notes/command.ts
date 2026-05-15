import type { TagItem } from '@/lib/api/schemas.ts';

/**
 * Parsed shape of the command-bar input. The query string is the single
 * source of truth for the notes filter (stored in the URL `?q=` param):
 *
 *   empty          → no filter (all notes)
 *   `#…`           → tag filter; `needle` keeps the nested path
 *                    (`#discovery#new` → needle `discovery#new`)
 *   `/…`           → folder filter; `path` keeps the nested path
 *                    (`/Clients/Intech` → path `Clients/Intech`)
 *   anything else  → free-text search
 */
export type ParsedCommand =
  | { kind: 'empty' }
  | { kind: 'tag'; needle: string }
  | { kind: 'folder'; path: string }
  | { kind: 'text'; q: string };

/**
 * Pure router for the command-bar input. Exported separately so the routing
 * logic is unit-tested without mounting the component. The tag needle is
 * lowercased (tag matching is case-insensitive); the folder path keeps its
 * case for display — `resolveFolderPath` lowercases per segment when matching.
 */
export const parseCommand = (raw: string): ParsedCommand => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  if (trimmed.startsWith('#')) return { kind: 'tag', needle: trimmed.slice(1).toLowerCase() };
  if (trimmed.startsWith('/')) return { kind: 'folder', path: trimmed.slice(1) };
  return { kind: 'text', q: trimmed };
};

/**
 * Filters the tag list against `needle`. Prefix matches rank above substring
 * matches so `#dis` ranks `discovery` above `playbook-discord`. Tag names may
 * carry nested paths (`discovery#new#01`); a parent-path needle therefore
 * surfaces every tag beneath it.
 */
export const filterTags = (
  tags: ReadonlyArray<TagItem>,
  needle: string,
): ReadonlyArray<TagItem> => {
  const n = needle.trim().toLowerCase();
  if (n === '') return tags;
  const prefix: TagItem[] = [];
  const contains: TagItem[] = [];
  for (const t of tags) {
    const name = t.name.toLowerCase();
    if (name.startsWith(n)) prefix.push(t);
    else if (name.includes(n)) contains.push(t);
  }
  return [...prefix, ...contains];
};

/**
 * Resolve a tag needle to a single tag id by exact (case-insensitive) name
 * match. Returns `null` while the needle is still a partial path — the notes
 * list only filters once a real tag is locked in.
 */
export const resolveTagId = (tags: ReadonlyArray<TagItem>, needle: string): string | null => {
  const n = needle.trim().toLowerCase();
  if (n === '') return null;
  return tags.find((t) => t.name.toLowerCase() === n)?.id ?? null;
};
