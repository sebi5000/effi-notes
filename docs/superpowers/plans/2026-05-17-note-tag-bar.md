# Note Tag Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tag bar to the note editor — between the meta-bar and the editing surface — to view, add, remove, and inline-create a note's tags.

**Architecture:** Frontend only. A new `TagBar` component renders the note's tag chips with an autocomplete add control; it calls back into `NotesShell`, which `PATCH`es the note's `tagIds` and creates tags via the existing tag API. A deterministic `tagColor` helper colours chips.

**Tech Stack:** Next.js 16, React 19, TypeScript 6 strict, Vitest + jsdom + @testing-library/react, TailwindCSS 4, next-intl, Tiptap editor.

**Spec:** `docs/superpowers/specs/2026-05-17-note-tag-bar-design.md`

**Conventions:** TDD where a task specifies a test. TypeScript strict (no `any` without `// reason:`). Conventional Commits. lefthook pre-commit MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root. `timeout` is unavailable on macOS. Commit directly to `main` (trunk-based, user-consented).

---

## Task 1: `tagColor` helper

**Files:**
- Create: `apps/web/src/lib/notes/tag-color.ts`
- Create: `apps/web/src/lib/notes/tag-color.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/tag-color.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { tagColor } from './tag-color.ts';

describe('tagColor', () => {
  it('is deterministic — the same name always yields the same colour', () => {
    expect(tagColor('discovery')).toBe(tagColor('discovery'));
  });

  it('returns a 7-character hex colour', () => {
    expect(tagColor('anything')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('handles an empty string', () => {
    expect(tagColor('')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/tag-color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/notes/tag-color.ts`:
```ts
const TAG_PALETTE = [
  '#C26A20',
  '#7C3F00',
  '#4B5066',
  '#2F6F4F',
  '#A03A2B',
  '#5A4B8A',
  '#9B6A2F',
  '#356680',
] as const;

/** Deterministic chip colour for a tag name — stable across renders/sessions. */
export const tagColor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length] ?? TAG_PALETTE[0];
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/tag-color.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/tag-color.ts apps/web/src/lib/notes/tag-color.test.ts
git commit -m "feat(notes): deterministic tagColor helper"
```

---

## Task 2: `TagBar` component + i18n

**Files:**
- Create: `apps/web/src/components/notes/Editor/TagBar.tsx`
- Create: `apps/web/src/components/notes/Editor/TagBar.test.tsx`
- Modify: `apps/web/messages/de.json`, `apps/web/messages/en.json`

- [ ] **Step 1: Add the i18n keys**

Add a `notes.tagBar` namespace to BOTH `apps/web/messages/de.json` and `apps/web/messages/en.json` with an identical key set (German wording in `de.json`, English in `en.json`). Keys and their English values:
- `addTag` → `"Tag"`
- `removeTag` → `"Remove tag {name}"`
- `createTag` → `"Create \"{name}\""`
- `placeholder` → `"Tag name…"`
- `noMatches` → `"No tags found"`
Use natural German equivalents in `de.json` (e.g. `removeTag` → `"Tag {name} entfernen"`, `createTag` → `"„{name}\" erstellen"`, `placeholder` → `"Tag-Name…"`, `noMatches` → `"Keine Tags gefunden"`). Place `notes.tagBar` consistently with the existing `notes.*` namespaces; confirm both files parse as JSON with matching keys.

- [ ] **Step 2: Write the failing test**

First read an existing editor component test (e.g. `apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx`) for the `@testing-library/react` + next-intl message-provider harness pattern.

Create `apps/web/src/components/notes/Editor/TagBar.test.tsx`. `TagBar`'s props are `{ tags, allTags, onChange, onCreateTag }` (see Step 3 for the exact types). Render it wrapped in the project's next-intl test provider with the `notes.tagBar` messages. Cover:
- renders a chip for each tag in `tags` (assert each tag name appears);
- clicking a chip's remove button (`aria-label` from `removeTag`) calls `onChange` with the remaining tag ids (without the removed one);
- clicking the "＋ Tag" button reveals a text input;
- typing a string that matches an existing `allTags` entry (not already attached) shows it in the dropdown, and clicking it calls `onChange` with `[...currentIds, matchId]`;
- typing a name that matches no tag shows a "Create …" row, and clicking it calls `onCreateTag(name)` then `onChange`;
- when `onChange` rejects, an inline `role="alert"` error appears.
`onChange` is `vi.fn().mockResolvedValue(undefined)`; `onCreateTag` is `vi.fn().mockResolvedValue({ id: 'new-id', name: <typed>, color: null })`.

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Editor/TagBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `TagBar.tsx`**

Create `apps/web/src/components/notes/Editor/TagBar.tsx`:
```tsx
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Editor/TagBar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Editor/TagBar.tsx apps/web/src/components/notes/Editor/TagBar.test.tsx apps/web/messages
git commit -m "feat(notes): TagBar component for editing a note's tags"
```

---

## Task 3: Wire `TagBar` into the editor

**Files:**
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`
- Modify: `apps/web/src/components/notes/NotesShell.tsx`

- [ ] **Step 1: Add the tag handlers to `NotesShell`**

First read `apps/web/src/components/notes/NotesShell.tsx` — note the `Props` (it receives `tags`), how `folders` is held as state (`folders: initialFolders` destructure → `useState`), the `notesApi`/`tagsApi` imports, the `notes`/`noteDetail` state, and where `<NoteEditor>` is rendered.

- Hold `tags` as state, mirroring `folders`: in the `Props` destructure rename the param to `tags: initialTags`; add `const [tags, setTags] = useState<ReadonlyArray<TagItem>>(initialTags);` (`TagItem` is already imported from `@/lib/api/schemas.ts`; if not, add it). Everything that reads `tags` keeps working unchanged.
- Add the import `import { tagColor } from '@/lib/notes/tag-color.ts';` and ensure `tagsApi` is imported from `@/lib/notes/api-client.ts` (add it to the existing import if absent).
- Add two `useCallback` handlers next to the existing note handlers:
```ts
  const handleSetNoteTags = useCallback(
    async (tagIds: string[]) => {
      if (!noteDetail) return;
      const updated = await notesApi.patch(noteDetail.id, { tagIds });
      setNoteDetail(updated);
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? { ...n, tags: updated.tags } : n)),
      );
    },
    [noteDetail],
  );

  const handleCreateTag = useCallback(async (name: string): Promise<TagItem> => {
    const tag = await tagsApi.create({ name, color: tagColor(name) });
    setTags((prev) => (prev.some((tg) => tg.id === tag.id) ? prev : [...prev, tag]));
    return tag;
  }, []);
```
- Where `<NoteEditor>` is rendered (inside the `noteDetail` branch), pass four more props:
  `noteTags={noteDetail.tags}`, `allTags={tags}`, `onTagsChange={handleSetNoteTags}`, `onCreateTag={handleCreateTag}`.

- [ ] **Step 2: Thread the props through `NoteEditor` and render `TagBar`**

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`:
- Add the imports: `import type { TagItem } from '@/lib/api/schemas.ts';` and `import { TagBar } from './TagBar.tsx';`.
- The outer `NoteEditor` `Props` type and the inner `CollaborativeEditor` props type both gain:
  ```ts
    noteTags: ReadonlyArray<TagItem>;
    allTags: ReadonlyArray<TagItem>;
    onTagsChange: (tagIds: string[]) => Promise<void>;
    onCreateTag: (name: string) => Promise<TagItem>;
  ```
  `NoteEditor` destructures all four and passes them straight through to `<CollaborativeEditor>` (and to `NoteEditorSkeleton` it does NOT — the skeleton is unchanged).
- In `CollaborativeEditor`'s returned JSX, render `<TagBar>` immediately after the meta-bar `<div className="…border-b pb-2">…</div>` and before the upload/delete error alerts:
  ```tsx
  <TagBar
    tags={noteTags}
    allTags={allTags}
    onChange={onTagsChange}
    onCreateTag={onCreateTag}
  />
  ```

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: PASS (all 8 packages). Fix any prop-type fallout in `NoteEditor`/`NotesShell` callers or test fixtures (a test rendering `NoteEditor` will need the four new props — pass `noteTags={[]}`, `allTags={[]}`, `onTagsChange={async () => {}}`, `onCreateTag={async () => ({ id: 't', name: 'x', color: null })}` or similar).
Run: `bun run vitest run apps/web/src/components/notes`
Expected: PASS — all component tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notes/Editor/NoteEditor.tsx apps/web/src/components/notes/NotesShell.tsx
git commit -m "feat(notes): render the TagBar in the note editor"
```

---

## Task 4: Full verification

**Files:** `vitest.config.ts` only if a coverage gap is found.

- [ ] **Step 1: Full test suite**

Run: `bun run vitest run`
Expected: all test files pass. `tag-color.ts` and `TagBar.tsx` are covered by the existing `apps/web/src/lib/notes/**/*.ts` / `apps/web/src/components/notes/**/*.tsx` coverage globs — no `vitest.config.ts` change expected. If the coverage gate fails for a genuinely-uncovered new file, add it to `include` and re-run.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 3: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. Catches Turbopack-only compile errors `vitest`/`tsc` miss. If it fails, fix the reported file and re-run Steps 1–3.

- [ ] **Step 4: Commit (only if a coverage-config change was needed)**

```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for the tag bar"
```
Otherwise nothing to commit.

---

## Self-Review

**Spec coverage:**
- `tagColor` helper → Task 1.
- `TagBar` component (chips, ✕ remove, ＋Tag autocomplete, create-new, inline error) → Task 2.
- i18n `notes.tagBar` keys → Task 2.
- Placement between meta-bar and editing surface → Task 3 Step 2.
- `NotesShell` `handleSetNoteTags` (PATCH `tagIds`, update `noteDetail` + sidebar row) and `handleCreateTag` (create via `tagsApi`, colour via `tagColor`, merge into the dictionary) → Task 3 Step 1.
- Frontend-only, no schema/API change → confirmed: no task touches Prisma, routes, or `schemas.ts`.
- Turbopack verification → Task 4.

**Placeholder scan:** No "TBD"/"implement later". Task 2 gives the full `TagBar` implementation; Task 3 gives the exact handlers and prop wiring.

**Type consistency:** `TagItem` (`{ id, name, color: string | null }`) is the chip/dictionary type throughout. `TagBar`'s props `{ tags, allTags, onChange, onCreateTag }` (Task 2) are fed by `NoteEditor`'s `{ noteTags, allTags, onTagsChange, onCreateTag }` (Task 3 Step 2) — note `TagBar`'s `tags`/`onChange` are wired from `NoteEditor`'s `noteTags`/`onTagsChange`. `onChange(tagIds: string[]) => Promise<void>` and `onCreateTag(name: string) => Promise<TagItem>` signatures match across `TagBar`, `NoteEditor`, and `NotesShell`'s `handleSetNoteTags`/`handleCreateTag`. `tagColor(name: string): string` defined in Task 1, used in Task 2 (`TagBar` chip fallback) and Task 3 (`handleCreateTag`).
