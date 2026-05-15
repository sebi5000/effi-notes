# Notes — Folder-Aware Search & Persistent Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the notes sidebar filter survive note navigation, let the command bar search folders with `/` (as it does tags with `#`), support nested folder/tag paths, and keep the notes list sorted by edit date.

**Architecture:** The filter string becomes a single URL search param (`?q=`), read by `NotesShell` via `useSearchParams()` — the single source of truth that survives the remount caused by `router.push('/notes/[id]')`. All query parsing and path resolution lives in pure, unit-tested modules (`lib/notes/command.ts`, `lib/notes/folder-tree.ts`); `NotesShell` is thin glue. Nested tags use a naming convention (no schema migration); nested folders use the existing `parentId` hierarchy.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Zod, next-intl, Vitest + Testing Library, Bun.

**Spec:** `docs/superpowers/specs/2026-05-15-notes-folder-search-design.md`

**Conventions:**
- Run a single test file with `bun run test <path>` (forwards to `vitest run <path>`). Pure/component tests need no database.
- Conventional Commits; `feat(notes):` / `test(notes):` / `refactor(notes):` / `i18n(notes):` as appropriate.
- Pre-commit hooks (lefthook: biome, eslint-next, typecheck) are mandatory — fix causes, never `--no-verify`.
- TypeScript strict, no `any`. Every user-visible string goes through next-intl.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `apps/web/src/lib/notes/folder-tree.ts` | + `folderPath`, `resolveFolderPath`, `filterFolderPaths` (pure folder-path helpers) | 1 |
| `apps/web/src/lib/notes/folder-tree.test.ts` | tests for the three new helpers | 1 |
| `apps/web/src/lib/notes/command.ts` | **new** — `ParsedCommand`, `parseCommand` (4 modes), `filterTags`, `resolveTagId` | 2 |
| `apps/web/src/lib/notes/command.test.ts` | **new** — tests for the query module | 2 |
| `apps/web/src/lib/api/schemas.ts` | relax tag-name regex to allow `#` as an interior separator | 3 |
| `apps/web/src/lib/api/schemas.test.ts` | **new** — tests for the tag-name regex | 3 |
| `apps/web/messages/en.json`, `apps/web/messages/de.json` | command-bar + sidebar strings | 4 |
| `apps/web/src/components/notes/Sidebar/CommandBar.tsx` | controlled input, folder dropdown, clear button | 5 |
| `apps/web/src/components/notes/Sidebar/CommandBar.test.tsx` | rewritten for the controlled API + folder mode | 5 |
| `apps/web/src/components/notes/Sidebar/index.tsx` | pass query props through; remove tag chip | 6 |
| `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx` | updated for the new `Sidebar` props | 6 |
| `apps/web/src/components/notes/NotesShell.tsx` | URL-driven filter wiring | 7 |
| `apps/web/src/app/notes/page.tsx`, `apps/web/src/app/notes/[noteId]/page.tsx` | wrap `NotesShell` in `<Suspense>` | 7 |

`FolderTree.tsx` is **not** modified — its `onSelect` callback is unchanged; only the handler `NotesShell` passes into it changes behavior.

---

## Task 1: Folder-path helpers in `folder-tree.ts`

Pure functions for turning a folder id into a `/`-path and back. This file is coverage-gated (`lib/notes/**`).

**Files:**
- Modify: `apps/web/src/lib/notes/folder-tree.ts` (append after `isNoopReorder`, end of file)
- Test: `apps/web/src/lib/notes/folder-tree.test.ts` (append new `describe` blocks)

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/notes/folder-tree.test.ts`. First add the three new names to the existing import block at the top of the file so it reads:

```ts
import {
  ancestorChain,
  buildFolderTree,
  childrenOf,
  computeReorder,
  computeRootReorder,
  filterFolderPaths,
  flatten,
  folderPath,
  isDescendant,
  isNoopReorder,
  moveSelection,
  resolveFolderPath,
} from './folder-tree.ts';
```

Then append these `describe` blocks at the end of the file (the `fixture` constant already defined in the file is reused):

```ts
describe('folderPath', () => {
  it('joins the ancestor names from root to the folder', () => {
    expect(folderPath(fixture, 'acme')).toBe('Clients/Acme');
    expect(folderPath(fixture, 'playbooks')).toBe('Internal/Playbooks');
  });

  it('returns the bare name for a root folder', () => {
    expect(folderPath(fixture, 'clients')).toBe('Clients');
  });

  it('returns an empty string for an unknown id', () => {
    expect(folderPath(fixture, 'missing')).toBe('');
  });
});

describe('resolveFolderPath', () => {
  it('resolves a nested path to the leaf folder id', () => {
    expect(resolveFolderPath(fixture, 'Clients/Acme')).toBe('acme');
    expect(resolveFolderPath(fixture, 'Internal/Playbooks')).toBe('playbooks');
  });

  it('matches segment names case-insensitively', () => {
    expect(resolveFolderPath(fixture, 'clients/acme')).toBe('acme');
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(resolveFolderPath(fixture, 'Clients/Acme/')).toBe('acme');
    expect(resolveFolderPath(fixture, ' Clients / Acme ')).toBe('acme');
  });

  it('returns null when a segment has no match', () => {
    expect(resolveFolderPath(fixture, 'Clients/Nope')).toBeNull();
    expect(resolveFolderPath(fixture, 'Acme')).toBeNull(); // Acme is not a root
  });

  it('returns null for an empty path', () => {
    expect(resolveFolderPath(fixture, '')).toBeNull();
    expect(resolveFolderPath(fixture, '   ')).toBeNull();
  });
});

describe('filterFolderPaths', () => {
  it('ranks prefix matches above substring matches', () => {
    const out = filterFolderPaths(fixture, 'clients');
    expect(out.map((f) => f.id)).toEqual(['clients', 'acme', 'globex']);
  });

  it('finds folders by a substring of their nested path', () => {
    const out = filterFolderPaths(fixture, 'playbooks');
    expect(out.map((f) => f.id)).toEqual(['playbooks']);
  });

  it('returns every folder for an empty needle', () => {
    expect(filterFolderPaths(fixture, '').length).toBe(fixture.length);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test apps/web/src/lib/notes/folder-tree.test.ts`
Expected: FAIL — `folderPath`, `resolveFolderPath`, `filterFolderPaths` are not exported.

- [ ] **Step 3: Implement the three helpers**

Append to `apps/web/src/lib/notes/folder-tree.ts` (after `isNoopReorder`, at the end of the file):

```ts
/**
 * The `/`-joined name path from root to `folderId`, e.g.
 * `Clients/Intech/Support`. Returns an empty string if `folderId` (or any
 * ancestor) is unknown.
 *
 * Note: a folder whose own name contains `/` is not round-trippable through
 * a path — an accepted limitation of the path syntax.
 */
export const folderPath = (folders: ReadonlyArray<FolderNode>, folderId: string): string => {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, f);
  const names: string[] = [];
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) return '';
    names.unshift(node.name);
    cursor = node.parentId;
  }
  return names.join('/');
};

/**
 * Resolve a `/`-style path (`Clients/Intech/Support`) to a folder id by
 * walking the tree from the root, matching each segment's name
 * case-insensitively. Returns `null` if any segment has no match. Segments
 * are trimmed; empty segments (e.g. a trailing slash) are dropped.
 */
export const resolveFolderPath = (
  folders: ReadonlyArray<FolderNode>,
  path: string,
): string | null => {
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  let parentId: string | null = null;
  let resolvedId: string | null = null;
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    const match = folders.find(
      (f) => (f.parentId ?? null) === parentId && f.name.toLowerCase() === lower,
    );
    if (!match) return null;
    resolvedId = match.id;
    parentId = match.id;
  }
  return resolvedId;
};

/**
 * Folders whose full path prefix- or substring-matches `needle`
 * (case-insensitive). Prefix matches rank first — parallels `filterTags`.
 * An empty needle returns every folder.
 */
export const filterFolderPaths = (
  folders: ReadonlyArray<FolderNode>,
  needle: string,
): FolderNode[] => {
  const n = needle.trim().toLowerCase();
  if (n === '') return folders.slice();
  const prefix: FolderNode[] = [];
  const contains: FolderNode[] = [];
  for (const f of folders) {
    const path = folderPath(folders, f.id).toLowerCase();
    if (path.startsWith(n)) prefix.push(f);
    else if (path.includes(n)) contains.push(f);
  }
  return [...prefix, ...contains];
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test apps/web/src/lib/notes/folder-tree.test.ts`
Expected: PASS — all `describe` blocks green, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/folder-tree.ts apps/web/src/lib/notes/folder-tree.test.ts
git commit -m "feat(notes): folder-path helpers for /-style search"
```

---

## Task 2: Query-parsing module `lib/notes/command.ts`

A new pure module that owns command-bar parsing. `parseCommand` gains a fourth mode (`folder`). `filterTags` moves here from `CommandBar.tsx`; `resolveTagId` is new. `CommandBar.tsx` is **not** touched in this task — it keeps its own local copies until Task 5 (transient, harmless duplication; the build stays green).

**Files:**
- Create: `apps/web/src/lib/notes/command.ts`
- Test: `apps/web/src/lib/notes/command.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/notes/command.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TagItem } from '@/lib/api/schemas.ts';
import { filterTags, parseCommand, resolveTagId } from './command.ts';

const tags: TagItem[] = [
  { id: 't1', name: 'discovery', color: '#C26A20' },
  { id: 't2', name: 'pricing', color: null },
  { id: 't3', name: 'discovery#new#01', color: null },
];

describe('parseCommand', () => {
  it('returns empty for blank input', () => {
    expect(parseCommand('')).toEqual({ kind: 'empty' });
    expect(parseCommand('   ')).toEqual({ kind: 'empty' });
  });

  it('routes a # prefix to tag mode (lowercased, # stripped)', () => {
    expect(parseCommand('#Discovery')).toEqual({ kind: 'tag', needle: 'discovery' });
    expect(parseCommand('  #discovery#new  ')).toEqual({
      kind: 'tag',
      needle: 'discovery#new',
    });
  });

  it('routes a / prefix to folder mode (case preserved, / stripped)', () => {
    expect(parseCommand('/Clients')).toEqual({ kind: 'folder', path: 'Clients' });
    expect(parseCommand('  /Clients/Intech/Support  ')).toEqual({
      kind: 'folder',
      path: 'Clients/Intech/Support',
    });
  });

  it('routes anything else to text mode', () => {
    expect(parseCommand('quarterly plan')).toEqual({ kind: 'text', q: 'quarterly plan' });
  });
});

describe('filterTags', () => {
  it('ranks prefix matches above substring matches', () => {
    const out = filterTags(tags, 'dis');
    expect(out.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('surfaces nested tags under a parent-path needle', () => {
    expect(filterTags(tags, 'discovery').map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('returns the unfiltered list for an empty needle', () => {
    expect(filterTags(tags, '').length).toBe(tags.length);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterTags(tags, 'zzz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterTags(tags, 'DISC').length).toBe(2);
  });
});

describe('resolveTagId', () => {
  it('resolves an exact (case-insensitive) name to its id', () => {
    expect(resolveTagId(tags, 'discovery')).toBe('t1');
    expect(resolveTagId(tags, 'DISCOVERY#NEW#01')).toBe('t3');
  });

  it('returns null for a partial needle', () => {
    expect(resolveTagId(tags, 'disc')).toBeNull();
  });

  it('returns null for an empty needle', () => {
    expect(resolveTagId(tags, '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test apps/web/src/lib/notes/command.test.ts`
Expected: FAIL — `./command.ts` does not exist.

- [ ] **Step 3: Implement the module**

Create `apps/web/src/lib/notes/command.ts`:

```ts
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

/**
 * Resolve a tag needle to a single tag id by exact (case-insensitive) name
 * match. Returns `null` while the needle is still a partial path — the notes
 * list only filters once a real tag is locked in.
 */
export const resolveTagId = (
  tags: ReadonlyArray<TagItem>,
  needle: string,
): string | null => {
  const n = needle.trim().toLowerCase();
  if (n === '') return null;
  return tags.find((t) => t.name.toLowerCase() === n)?.id ?? null;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test apps/web/src/lib/notes/command.test.ts`
Expected: PASS — all three `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/command.ts apps/web/src/lib/notes/command.test.ts
git commit -m "feat(notes): query-parsing module with folder mode + tag resolver"
```

---

## Task 3: Relax the tag-name regex in `schemas.ts`

Allow `#` as an interior level separator so nested tag names like
`discovery#new#01` validate. The regex itself forbids a leading, trailing, or
doubled `#`.

**Files:**
- Modify: `apps/web/src/lib/api/schemas.ts:85-92` (`createTagSchema`)
- Test: `apps/web/src/lib/api/schemas.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/api/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTagSchema } from './schemas.ts';

describe('createTagSchema — tag name', () => {
  it('accepts a plain name', () => {
    expect(createTagSchema.safeParse({ name: 'discovery' }).success).toBe(true);
  });

  it('accepts a nested name with # separators', () => {
    expect(createTagSchema.safeParse({ name: 'discovery#new#01' }).success).toBe(true);
  });

  it('rejects a leading #', () => {
    expect(createTagSchema.safeParse({ name: '#discovery' }).success).toBe(false);
  });

  it('rejects a trailing #', () => {
    expect(createTagSchema.safeParse({ name: 'discovery#' }).success).toBe(false);
  });

  it('rejects a doubled ##', () => {
    expect(createTagSchema.safeParse({ name: 'discovery##new' }).success).toBe(false);
  });

  it('still rejects spaces', () => {
    expect(createTagSchema.safeParse({ name: 'has spaces' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test apps/web/src/lib/api/schemas.test.ts`
Expected: FAIL — `discovery#new#01` is currently rejected by the regex.

- [ ] **Step 3: Update the regex**

In `apps/web/src/lib/api/schemas.ts`, replace the `name` field of `createTagSchema` (currently lines 86-90):

```ts
  name: z
    .string()
    .min(1)
    .max(TAG_NAME_MAX)
    .regex(/^[\p{L}\p{N}_-]+$/u, 'letters, numbers, _ and - only'),
```

with:

```ts
  name: z
    .string()
    .min(1)
    .max(TAG_NAME_MAX)
    .regex(
      /^[\p{L}\p{N}_-]+(?:#[\p{L}\p{N}_-]+)*$/u,
      'letters, numbers, _ and -, with # as an interior level separator',
    ),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test apps/web/src/lib/api/schemas.test.ts`
Expected: PASS — all six cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/schemas.ts apps/web/src/lib/api/schemas.test.ts
git commit -m "feat(notes): allow # as a nested-tag level separator"
```

---

## Task 4: i18n messages

Update the command-bar strings, add folder-suggestion + clear-button +
loading strings, and remove the now-unused tag-chip strings. **Both** locale
files must carry the same keys.

**Files:**
- Modify: `apps/web/messages/en.json` (`notes.sidebar`, `notes.commandBar`)
- Modify: `apps/web/messages/de.json` (`notes.sidebar`, `notes.commandBar`)

- [ ] **Step 1: Update `en.json`**

In `apps/web/messages/en.json`, replace the `"sidebar"` block:

```json
    "sidebar": {
      "foldersHeading": "Folders",
      "tagsHeading": "Tags",
      "notesHeading": "Notes",
      "emptyState": "No notes here yet.",
      "filterByTag": "Filter:",
      "clearTag": "Clear tag filter"
    },
```

with:

```json
    "sidebar": {
      "foldersHeading": "Folders",
      "tagsHeading": "Tags",
      "notesHeading": "Notes",
      "emptyState": "No notes here yet.",
      "loading": "Loading…"
    },
```

and replace the `"commandBar"` block:

```json
    "commandBar": {
      "label": "Search notes",
      "placeholder": "Search · #tag…",
      "hint": "Type # to filter by tag (e.g. #discovery)",
      "noTagMatch": "No tags match."
    },
```

with:

```json
    "commandBar": {
      "label": "Search notes",
      "placeholder": "Search · #tag · /folder…",
      "hint": "Type # for tags, / for folders",
      "noTagMatch": "No tags match.",
      "noFolderMatch": "No folders match.",
      "clearSearch": "Clear search"
    },
```

- [ ] **Step 2: Update `de.json`**

In `apps/web/messages/de.json`, replace the `"sidebar"` block:

```json
    "sidebar": {
      "foldersHeading": "Ordner",
      "tagsHeading": "Tags",
      "notesHeading": "Notizen",
      "emptyState": "Hier gibt es noch keine Notizen.",
      "filterByTag": "Filter:",
      "clearTag": "Tag-Filter entfernen"
    },
```

with:

```json
    "sidebar": {
      "foldersHeading": "Ordner",
      "tagsHeading": "Tags",
      "notesHeading": "Notizen",
      "emptyState": "Hier gibt es noch keine Notizen.",
      "loading": "Wird geladen…"
    },
```

and replace the `"commandBar"` block:

```json
    "commandBar": {
      "label": "Notizen durchsuchen",
      "placeholder": "Suchen · #tag…",
      "hint": "Tippen Sie #, um nach Tag zu filtern (z. B. #discovery)",
      "noTagMatch": "Keine passenden Tags."
    },
```

with:

```json
    "commandBar": {
      "label": "Notizen durchsuchen",
      "placeholder": "Suchen · #tag · /ordner…",
      "hint": "# für Tags, / für Ordner",
      "noTagMatch": "Keine passenden Tags.",
      "noFolderMatch": "Keine passenden Ordner.",
      "clearSearch": "Suche löschen"
    },
```

- [ ] **Step 3: Verify both files are valid JSON and key-aligned**

Run: `node -e "const e=require('./apps/web/messages/en.json'),d=require('./apps/web/messages/de.json'); const k=o=>Object.keys(o).sort().join(','); for (const ns of ['sidebar','commandBar']) { if(k(e.notes[ns])!==k(d.notes[ns])) throw new Error('key mismatch in '+ns); } console.log('en/de keys aligned');"`
Expected: prints `en/de keys aligned`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/en.json apps/web/messages/de.json
git commit -m "i18n(notes): command-bar folder-search + clear strings"
```

---

## Task 5: CommandBar — controlled input, folder dropdown, clear button

`CommandBar` becomes a **controlled** component: its value comes from the
`value` prop and every change is reported via `onChange`. It gains a folder-
suggestion dropdown (mirroring the tag one), an explicit clear (`×`) button,
and drops `onTagSelect` — selecting a tag now just sets the value to
`#<name>`. `parseCommand`/`filterTags` are imported from `lib/notes/command.ts`
(local copies deleted).

**Files:**
- Modify (full rewrite): `apps/web/src/components/notes/Sidebar/CommandBar.tsx`
- Modify (full rewrite): `apps/web/src/components/notes/Sidebar/CommandBar.test.tsx`

- [ ] **Step 1: Write the failing tests — rewrite `CommandBar.test.tsx`**

Replace the entire contents of `apps/web/src/components/notes/Sidebar/CommandBar.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode, SearchHit, TagItem } from '@/lib/api/schemas.ts';
import { CommandBar } from './CommandBar.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    commandBar: {
      label: 'Search',
      placeholder: 'Search notes…',
      hint: 'Type # for tags, / for folders',
      noTagMatch: 'No tags match.',
      noFolderMatch: 'No folders match.',
      clearSearch: 'Clear search',
    },
  },
} as const;

const tags: TagItem[] = [
  { id: 't1', name: 'discovery', color: '#C26A20' },
  { id: 't2', name: 'pricing', color: null },
  { id: 't3', name: 'discord-sync', color: null },
];

const folders: FolderNode[] = [
  {
    id: 'clients',
    name: 'Clients',
    parentId: null,
    position: 0,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  },
  {
    id: 'acme',
    name: 'Acme',
    parentId: 'clients',
    position: 0,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  },
];

const noHits = async (): Promise<{ hits: SearchHit[]; total: number }> => ({
  hits: [],
  total: 0,
});

/** Test harness — CommandBar is controlled, so a stateful wrapper holds `value`. */
function Controlled(props: {
  initial?: string;
  onChange?: (next: string) => void;
  onSelect?: (id: string) => void;
  search?: (q: string) => Promise<{ hits: SearchHit[]; total: number }>;
  debounceMs?: number;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <CommandBar
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      onSelect={props.onSelect ?? (() => undefined)}
      folders={folders}
      tags={tags}
      search={props.search ?? noHits}
      debounceMs={props.debounceMs ?? 10}
    />
  );
}

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('CommandBar — text-search mode', () => {
  it('renders an accessible search input', () => {
    const { container } = render(wrap(<Controlled />));
    const search = container.querySelector('search');
    expect(search?.querySelector('input')).toBeTruthy();
  });

  it('calls the search fn after the debounce window', async () => {
    const search = vi.fn(noHits);
    const { container } = render(wrap(<Controlled search={search} debounceMs={20} />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'strategy' },
    });
    await waitFor(() => expect(search).toHaveBeenCalledWith('strategy'), { timeout: 200 });
  });

  it('renders the results list and Enter opens the first hit', async () => {
    const onSelect = vi.fn();
    const search = vi.fn(async () => ({
      hits: [{ id: 'n1', title: 'Hit One', snippet: '', folderId: null, updatedAt: '' }],
      total: 1,
    }));
    const { container } = render(wrap(<Controlled onSelect={onSelect} search={search} />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'h' } });
    await waitFor(() => expect(within(container).queryByText('Hit One')).not.toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('n1');
  });
});

describe('CommandBar — tag mode', () => {
  it('shows the tag-suggestion dropdown when input starts with #', () => {
    const { container } = render(wrap(<Controlled />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#dis' },
    });
    const list = within(container).getByLabelText('Tag suggestions');
    expect(list.textContent).toContain('discovery');
    expect(list.textContent).toContain('discord-sync');
  });

  it('does not call the text-search fn while in tag mode', () => {
    const search = vi.fn(noHits);
    const { container } = render(wrap(<Controlled search={search} />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#disc' },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('clicking a tag sets the value to #<name> and closes the dropdown', async () => {
    const { container } = render(wrap(<Controlled />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#pri' } });
    fireEvent.click(within(container).getByText('#pricing'));
    await waitFor(() => expect(input.value).toBe('#pricing'));
    expect(within(container).queryByLabelText('Tag suggestions')).toBeNull();
  });

  it('shows "no tags match" when the needle has no hit', () => {
    const { container } = render(wrap(<Controlled />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '#zzz' },
    });
    expect(within(container).getByLabelText('Tag suggestions').textContent).toContain(
      'No tags match',
    );
  });
});

describe('CommandBar — folder mode', () => {
  it('shows the folder-suggestion dropdown when input starts with /', () => {
    const { container } = render(wrap(<Controlled />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '/cli' },
    });
    const list = within(container).getByLabelText('Folder suggestions');
    expect(list.textContent).toContain('/Clients');
    expect(list.textContent).toContain('/Clients/Acme');
  });

  it('clicking a folder sets the value to its full /path', async () => {
    const { container } = render(wrap(<Controlled />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/cli' } });
    fireEvent.click(within(container).getByText('/Clients/Acme'));
    await waitFor(() => expect(input.value).toBe('/Clients/Acme'));
    expect(within(container).queryByLabelText('Folder suggestions')).toBeNull();
  });

  it('Enter applies the first folder match', async () => {
    const { container } = render(wrap(<Controlled />));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/cli' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('/Clients'));
  });

  it('does not call the text-search fn while in folder mode', () => {
    const search = vi.fn(noHits);
    const { container } = render(wrap(<Controlled search={search} />));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: '/cli' },
    });
    expect(search).not.toHaveBeenCalled();
  });
});

describe('CommandBar — clear button', () => {
  it('renders no clear button when the value is empty', () => {
    const { container } = render(wrap(<Controlled />));
    expect(within(container).queryByLabelText('Clear search')).toBeNull();
  });

  it('clicking the clear button empties the value', async () => {
    const { container } = render(wrap(<Controlled initial="#discovery" />));
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('#discovery');
    fireEvent.click(within(container).getByLabelText('Clear search'));
    await waitFor(() => expect(input.value).toBe(''));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test apps/web/src/components/notes/Sidebar/CommandBar.test.tsx`
Expected: FAIL — `CommandBar` does not yet accept `value`/`onChange`/`folders` as defined here (it still has the old `onSelect`/`onTagSelect` signature and no folder dropdown).

- [ ] **Step 3: Rewrite `CommandBar.tsx`**

Replace the entire contents of `apps/web/src/components/notes/Sidebar/CommandBar.tsx` with:

```tsx
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test apps/web/src/components/notes/Sidebar/CommandBar.test.tsx`
Expected: PASS — all four `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/CommandBar.tsx apps/web/src/components/notes/Sidebar/CommandBar.test.tsx
git commit -m "feat(notes): controlled command bar with /-folder search + clear"
```

---

## Task 6: Sidebar — thread query props through, drop the tag chip

`Sidebar` stops owning a `selectedTagId`/`onSelectTag` filter. It receives the
controlled `query` + `onQueryChange` and passes them to `CommandBar`, gains a
`pending` flag for the notes-list loading state, and removes the standalone
"Filter: #tag ×" chip.

**Files:**
- Modify (full rewrite): `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Update the failing tests — `Sidebar.test.tsx`**

In `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`, replace the `messages` constant's `commandBar` line and `sidebar` block so the namespace matches the new keys. Replace lines 10-26 (the `messages` constant) with:

```tsx
const messages = {
  notes: {
    sidebar: {
      foldersHeading: 'Folders',
      tagsHeading: 'Tags',
      notesHeading: 'Notes',
      emptyState: 'No notes here yet.',
      loading: 'Loading…',
    },
    folderActions: {
      newFolder: 'New folder',
      newFolderPlaceholder: 'Folder name',
      rename: 'Rename folder',
      delete: 'Delete folder',
    },
    commandBar: {
      label: 'Search',
      placeholder: 'Search…',
      hint: 'Type # for tags, / for folders',
      noTagMatch: 'No tags match.',
      noFolderMatch: 'No folders match.',
      clearSearch: 'Clear search',
    },
  },
} as const;
```

Then, in **every** `<Sidebar … />` element in this file, replace the prop pair

```tsx
          selectedFolderId={null}
          selectedTagId={null}
          selectedNoteId={null}
          onSelectFolder={() => undefined}
          onSelectTag={() => undefined}
          onSelectNote={() => undefined}
```

with

```tsx
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
```

and the one occurrence of `selectedFolderId="clients"` keeps its value — only its sibling `selectedTagId`/`onSelectTag` lines are removed and `query`/`onQueryChange` added, i.e. that block becomes:

```tsx
          selectedFolderId="clients"
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
```

Append one new test at the end of the file, before the final `});` is **not** needed — add it as a new top-level `describe` after the existing one:

```tsx
describe('Sidebar — notes list', () => {
  it('shows the loading row while pending and the list is empty', () => {
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={notes}
          pending
          selectedFolderId={null}
          selectedNoteId={null}
          query="/Clients"
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(within(container).getByText('Loading…')).toBeTruthy();
  });

  it('lists notes once loaded', () => {
    const loaded: NoteListItem[] = [
      {
        id: 'n1',
        title: 'First note',
        folderId: null,
        authorId: 'u1',
        archivedAt: null,
        updatedAt: '2026-05-14T00:00:00.000Z',
        tags: [],
      },
    ];
    const { container } = render(
      wrap(
        <Sidebar
          folders={folders}
          tags={tags}
          notes={loaded}
          selectedFolderId={null}
          selectedNoteId={null}
          query=""
          onQueryChange={() => undefined}
          onSelectFolder={() => undefined}
          onSelectNote={() => undefined}
        />,
      ),
    );
    expect(within(container).getByText('First note')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: FAIL — `Sidebar` does not yet accept `query`/`onQueryChange`/`pending` and still requires `selectedTagId`/`onSelectTag` (TypeScript / render errors).

- [ ] **Step 3: Rewrite `Sidebar/index.tsx`**

Replace the entire contents of `apps/web/src/components/notes/Sidebar/index.tsx` with:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FolderNode, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { CommandBar } from './CommandBar.tsx';
import { type FolderMutationHandlers, FolderTree } from './FolderTree.tsx';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  notes: ReadonlyArray<NoteListItem>;
  /** True while the filtered notes list is being fetched. */
  pending?: boolean;
  /** Current command-bar query — the single source of truth for the filter. */
  query: string;
  selectedFolderId: string | null;
  selectedNoteId: string | null;
  onQueryChange: (next: string) => void;
  onSelectFolder: (id: string | null) => void;
  onSelectNote: (id: string) => void;
  folderMutations?: FolderMutationHandlers & {
    onCreate: (name: string, parentId: string | null) => Promise<void>;
  };
};

export function Sidebar({
  folders,
  tags,
  notes,
  pending = false,
  query,
  selectedFolderId,
  selectedNoteId,
  onQueryChange,
  onSelectFolder,
  onSelectNote,
  folderMutations,
}: Props) {
  const t = useTranslations('notes.sidebar');
  const tA = useTranslations('notes.folderActions');
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const submitCreate = async () => {
    if (!folderMutations) return;
    const name = createName.trim();
    if (name.length === 0) {
      setCreating(false);
      setCreateName('');
      return;
    }
    try {
      await folderMutations.onCreate(name, selectedFolderId);
      setCreating(false);
      setCreateName('');
      setCreateError(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'create failed');
    }
  };

  return (
    <aside className="border-paper-line/80 flex h-full flex-col gap-4 border-r p-4">
      <header className="flex items-center gap-2">
        <span className="font-display text-foreground text-lg font-semibold tracking-tight">
          effi · notes
        </span>
      </header>

      <CommandBar
        value={query}
        onChange={onQueryChange}
        onSelect={onSelectNote}
        folders={folders}
        tags={tags}
      />

      <section aria-label={t('foldersHeading')} className="flex-1 overflow-y-auto">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {t('foldersHeading')}
          </h3>
          {folderMutations ? (
            <button
              type="button"
              aria-label={tA('newFolder')}
              title={tA('newFolder')}
              onClick={() => setCreating(true)}
              className="text-muted-foreground/70 hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded text-sm leading-none"
            >
              +
            </button>
          ) : null}
        </div>

        {creating && folderMutations ? (
          <div className="mb-1 flex items-center gap-1 px-2 py-1">
            <span aria-hidden="true" className="inline-block h-4 w-4" />
            <input
              ref={(el) => {
                if (el) el.focus();
              }}
              aria-label={tA('newFolder')}
              value={createName}
              placeholder={tA('newFolderPlaceholder')}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitCreate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setCreating(false);
                  setCreateName('');
                }
              }}
              onBlur={() => void submitCreate()}
              className="border-border bg-background font-display flex-1 rounded border px-1 py-0.5 text-sm focus:outline-none"
            />
          </div>
        ) : null}

        <FolderTree
          folders={folders}
          selectedId={selectedFolderId}
          onSelect={onSelectFolder}
          {...(folderMutations
            ? {
                mutations: {
                  onRename: folderMutations.onRename,
                  onDelete: folderMutations.onDelete,
                  ...(folderMutations.onReorder ? { onReorder: folderMutations.onReorder } : {}),
                },
              }
            : {})}
        />

        {createError !== null ? (
          <div role="alert" className="text-danger mt-2 rounded bg-red-50 px-2 py-1 text-xs">
            {createError}
          </div>
        ) : null}

        <h3 className="text-muted-foreground mb-1 mt-4 text-xs font-medium uppercase tracking-wide">
          {t('notesHeading')}
        </h3>
        <ul aria-label={t('notesHeading')} className="space-y-0.5">
          {pending && notes.length === 0 ? (
            <li className="text-muted-foreground/70 px-2 py-1 text-sm italic">{t('loading')}</li>
          ) : notes.length === 0 ? (
            <li className="text-muted-foreground/70 px-2 py-1 text-sm italic">{t('emptyState')}</li>
          ) : (
            notes.map((n) => {
              const isSel = n.id === selectedNoteId;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNote(n.id)}
                    aria-current={isSel ? 'true' : undefined}
                    className={`hover:bg-muted/60 block w-full rounded px-2 py-1 text-left text-sm ${
                      isSel ? 'bg-muted text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    <div className="font-display truncate">{n.title}</div>
                    {n.tags.length > 0 ? (
                      <div className="text-muted-foreground/70 mt-0.5 flex gap-1 text-[10px]">
                        {n.tags.slice(0, 3).map((tag) => (
                          <span key={tag.id}>#{tag.name}</span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </aside>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: PASS — folder-mutation tests and the new notes-list tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/index.tsx apps/web/src/components/notes/Sidebar/Sidebar.test.tsx
git commit -m "feat(notes): sidebar threads controlled query, drops tag chip"
```

---

## Task 7: NotesShell — URL-driven filter wiring

`NotesShell` reads the filter from the URL `?q=` param, derives the resolved
folder/tag id, fetches the matching notes list, and preserves `q` when opening
a note. This is the glue that fixes the bug: the filter now survives the
remount caused by navigating to `/notes/[noteId]`.

`NotesShell` is **not** Vitest-coverage-gated (the shell is covered by Phase E
E2E). Verification for this task is `typecheck` + `lint` + `build` + a manual
dev-server check.

**Files:**
- Modify (full rewrite): `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `apps/web/src/app/notes/page.tsx` (wrap `NotesShell` in `<Suspense>`)
- Modify: `apps/web/src/app/notes/[noteId]/page.tsx` (wrap `NotesShell` in `<Suspense>`)

- [ ] **Step 1: Rewrite `NotesShell.tsx`**

Replace the entire contents of `apps/web/src/components/notes/NotesShell.tsx` with:

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FolderNode, NoteDetail, NoteListItem, TagItem } from '@/lib/api/schemas.ts';
import { foldersApi, notesApi } from '@/lib/notes/api-client.ts';
import { parseCommand, resolveTagId } from '@/lib/notes/command.ts';
import { folderPath, resolveFolderPath } from '@/lib/notes/folder-tree.ts';
import { NoteEditor } from './Editor/NoteEditor.tsx';
import { Sidebar } from './Sidebar/index.tsx';

type Props = {
  folders: ReadonlyArray<FolderNode>;
  tags: ReadonlyArray<TagItem>;
  initialNotes: ReadonlyArray<NoteListItem>;
  currentUser: { id: string; name: string; color: string };
  initialNote: NoteDetail | null;
};

/** ISO timestamps sort lexically; newest-edited first. Defensive guard on top
 *  of the API's own `orderBy: { updatedAt: 'desc' }`. */
const byUpdatedAtDesc = (notes: ReadonlyArray<NoteListItem>): NoteListItem[] =>
  [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const qSuffix = (q: string): string => (q.length > 0 ? `?q=${encodeURIComponent(q)}` : '');

export function NotesShell({
  folders: initialFolders,
  tags,
  initialNotes,
  currentUser,
  initialNote,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('notes.shell');

  const query = searchParams.get('q') ?? '';
  const [folders, setFolders] = useState<ReadonlyArray<FolderNode>>(initialFolders);
  const [noteDetail, setNoteDetail] = useState<NoteDetail | null>(initialNote);

  // The URL `?q=` param is the single source of truth for the filter. It is
  // parsed into a resolved folder/tag id; an unresolvable partial path (still
  // being typed) leaves both null → the list shows all notes.
  const parsed = useMemo(() => parseCommand(query), [query]);
  const folderId = useMemo(
    () => (parsed.kind === 'folder' ? resolveFolderPath(folders, parsed.path) : null),
    [parsed, folders],
  );
  const tagId = useMemo(
    () => (parsed.kind === 'tag' ? resolveTagId(tags, parsed.needle) : null),
    [parsed, tags],
  );

  const filterActive = folderId !== null || tagId !== null;
  const [notes, setNotes] = useState<ReadonlyArray<NoteListItem>>(() =>
    filterActive ? [] : byUpdatedAtDesc(initialNotes),
  );
  const [pending, setPending] = useState(filterActive);

  // Re-fetch whenever the resolved filter changes. Keyed on folderId/tagId —
  // not raw `query` — so typing free text never triggers a list fetch.
  useEffect(() => {
    let cancelled = false;
    setPending(true);
    (async () => {
      try {
        const list = await notesApi.list({
          ...(folderId !== null ? { folderId } : {}),
          ...(tagId !== null ? { tagId } : {}),
        });
        if (!cancelled) setNotes(byUpdatedAtDesc(list.notes));
      } catch {
        // keep the previous list on error
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, tagId]);

  const setQuery = useCallback(
    (next: string) => {
      router.replace(`${pathname}${qSuffix(next)}`);
    },
    [router, pathname],
  );

  const selectFolder = useCallback(
    (id: string | null) => {
      if (id === null) setQuery('');
      else setQuery(`/${folderPath(folders, id)}`);
    },
    [setQuery, folders],
  );

  const openNote = async (id: string) => {
    router.push(`/notes/${id}${qSuffix(query)}`);
    try {
      const detail = await notesApi.get(id);
      setNoteDetail(detail);
    } catch {
      // ignore — the destination page re-fetches server-side
    }
  };

  const refreshFolders = useCallback(async () => {
    try {
      const res = await foldersApi.list();
      setFolders(res.folders);
    } catch {
      // ignore — keep current state
    }
  }, []);

  const handleCreateFolder = useCallback(
    async (name: string, parentId: string | null) => {
      await foldersApi.create({
        name,
        ...(parentId !== null ? { parentId } : {}),
      });
      await refreshFolders();
    },
    [refreshFolders],
  );

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      await foldersApi.patch(id, { name });
      await refreshFolders();
    },
    [refreshFolders],
  );

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      await foldersApi.delete(id);
      await refreshFolders();
      if (folderId === id) setQuery('');
    },
    [refreshFolders, folderId, setQuery],
  );

  const handleReorderFolders = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      await foldersApi.reorder(parentId, orderedIds);
      await refreshFolders();
    },
    [refreshFolders],
  );

  return (
    <div className="grid h-screen grid-cols-[280px_1fr]">
      <Sidebar
        folders={folders}
        tags={tags}
        notes={notes}
        pending={pending}
        query={query}
        selectedFolderId={folderId}
        selectedNoteId={noteDetail?.id ?? null}
        onQueryChange={setQuery}
        onSelectFolder={selectFolder}
        onSelectNote={openNote}
        folderMutations={{
          onCreate: handleCreateFolder,
          onRename: handleRenameFolder,
          onDelete: handleDeleteFolder,
          onReorder: handleReorderFolders,
        }}
      />
      <main className="flex flex-col px-12 py-10">
        {noteDetail ? (
          <>
            <h1 className="font-display text-foreground mb-4 text-3xl font-semibold">
              {noteDetail.title}
            </h1>
            <NoteEditor
              key={noteDetail.id}
              noteId={noteDetail.id}
              initialTitle={noteDetail.title}
              initialBody={noteDetail.body}
              initialUpdatedAt={noteDetail.updatedAt}
              currentUser={currentUser}
            />
          </>
        ) : (
          <div className="text-muted-foreground flex flex-1 items-center justify-center">
            <div className="max-w-md text-center">
              <h2 className="font-display text-foreground mb-2 text-2xl">{t('welcome')}</h2>
              <p className="text-muted-foreground">{t('emptyHint')}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Wrap `NotesShell` in `<Suspense>` — `notes/page.tsx`**

`useSearchParams()` requires a Suspense boundary. In `apps/web/src/app/notes/page.tsx`:

Add to the imports at the top of the file:

```tsx
import { Suspense } from 'react';
```

Then change the `return (` block so `<NotesShell … />` is wrapped:

```tsx
  return (
    <Suspense fallback={null}>
      <NotesShell
        folders={folders.map((f) => ({
          ...f,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
        }))}
        tags={tags}
        initialNotes={notes.map((n) => ({
          id: n.id,
          title: n.title,
          folderId: n.folderId,
          authorId: n.authorId,
          archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
          updatedAt: n.updatedAt.toISOString(),
          tags: n.tags.map((t) => t.tag),
        }))}
        currentUser={{
          id: session.user.id,
          name: session.user.displayName ?? session.user.email,
          color: hashToColor(session.user.id),
        }}
        initialNote={null}
      />
    </Suspense>
  );
```

- [ ] **Step 3: Wrap `NotesShell` in `<Suspense>` — `notes/[noteId]/page.tsx`**

In `apps/web/src/app/notes/[noteId]/page.tsx`:

Add to the imports at the top of the file:

```tsx
import { Suspense } from 'react';
```

Then change the `return (` block so `<NotesShell … />` is wrapped — replace the existing `return ( <NotesShell … /> );` with `return ( <Suspense fallback={null}><NotesShell … /></Suspense> );`, keeping all existing `<NotesShell>` props (`folders`, `tags`, `initialNotes`, `currentUser`, `initialNote`) exactly as they are.

- [ ] **Step 4: Verify typecheck, lint, and build**

Run: `bun run typecheck`
Expected: PASS — no type errors.

Run: `bun run lint`
Expected: PASS — no lint errors.

Run: `cd apps/web && bunx eslint . && cd ../..`
Expected: PASS — Next-specific ESLint rules (incl. the `useSearchParams` Suspense rule) clean.

Run: `bun run build`
Expected: the Next build of `apps/web` completes with no error about `useSearchParams()` needing a Suspense boundary.

- [ ] **Step 5: Manual dev-server verification**

Run the dev stack (`make up` for Postgres/Redis/Keycloak if not already running, then `bun run dev`), sign in, open `/notes`, and confirm:
1. Selecting a folder writes `/FolderName` into the search field and the notes list narrows to that folder.
2. Opening a note from that filtered list keeps the folder filter — the sidebar still shows only that folder's notes (this is the original bug).
3. Clearing the search field (the `×` button) restores the full notes list.
4. Typing `/Cli` shows a folder-suggestion dropdown; typing `#dis` shows a tag-suggestion dropdown.
5. The notes list is ordered newest-edited-first.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/NotesShell.tsx apps/web/src/app/notes/page.tsx "apps/web/src/app/notes/[noteId]/page.tsx"
git commit -m "feat(notes): URL-driven filter survives note navigation"
```

---

## Task 8: Full verification

Run the complete suite (this stage needs a real Postgres + Redis — the API
route tests are integration tests per CLAUDE.md; start them with `make up` if
not running).

**Files:** none — verification only.

- [ ] **Step 1: Full type + lint check**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 2: Full test suite with coverage**

Run: `bun run test --coverage`
Expected: PASS — all tests green, and coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The coverage-gated files touched here — `lib/notes/command.ts`, `lib/notes/folder-tree.ts`, `lib/api/schemas.ts`, `components/notes/Sidebar/CommandBar.tsx` — must each stay above threshold.

- [ ] **Step 3: If coverage dips below threshold**

Identify the uncovered lines from the coverage report (`coverage/index.html` or the terminal summary) and add targeted tests to the corresponding `*.test.ts(x)` file — `command.test.ts`, `folder-tree.test.ts`, `schemas.test.ts`, or `CommandBar.test.tsx`. Re-run Step 2. Commit any added tests:

```bash
git add apps/web/src/lib apps/web/src/components/notes/Sidebar
git commit -m "test(notes): cover folder-search edge cases"
```

- [ ] **Step 4: Confirm the branch is clean**

Run: `git status --short`
Expected: no uncommitted changes from this plan's files.

---

## Self-Review

**Spec coverage:**
- Spec §1 (search folders with `/`) → Task 2 (`parseCommand` folder mode) + Task 5 (folder dropdown). ✅
- Spec §2 (folder click → search field; clearing restores all) → Task 7 (`selectFolder` sets `q`) + Task 5 (clear `×` button). ✅
- Spec §3 (nested folders/tags in search) → Task 1 (`resolveFolderPath`/`folderPath`/`filterFolderPaths` walk the `parentId` tree) + Task 3 (tag-name regex allows `#`) + Task 2 (`filterTags` prefix match surfaces nested tags). ✅
- Spec §4 (notes sorted by edit date) → Task 7 (`byUpdatedAtDesc` guard; URL-driven re-fetch refreshes order on every navigation; API `orderBy` unchanged). ✅
- Spec — root-cause fix (filter survives navigation) → Task 7 (URL `?q=` param). ✅
- Spec — remove tag chip / single source of truth → Task 6. ✅
- Spec — i18n updates → Task 4. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete content; no "similar to Task N" references.

**Type consistency:** `ParsedCommand` (Task 2) is used by `CommandBar` (Task 5) and `NotesShell` (Task 7). `parseCommand`, `filterTags`, `resolveTagId` imported from `@/lib/notes/command.ts` consistently. `folderPath`, `resolveFolderPath`, `filterFolderPaths` imported from `@/lib/notes/folder-tree.ts` consistently. `CommandBar` props (`value`, `onChange`, `onSelect`, `folders`, `tags`, `search`, `debounceMs`) match between definition (Task 5) and caller `Sidebar` (Task 6). `Sidebar` props (`pending`, `query`, `selectedFolderId`, `selectedNoteId`, `onQueryChange`, `onSelectFolder`, `onSelectNote`, `folderMutations`) match between definition (Task 6) and caller `NotesShell` (Task 7). `onTagSelect`/`selectedTagId` fully removed from `CommandBar`, `Sidebar`, and `NotesShell`.
