# Folder Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every folder an icon, chosen from a curated 24-icon set by clicking the folder's icon.

**Architecture:** A non-null `Folder.icon` column stores a Lucide icon key. A pure `folder-icons.ts` module is the single source of truth (the key list + a Zod enum). A `FolderIcon` component maps a key to a `lucide-react` component; a hand-rolled, portalled `FolderIconPicker` popover offers the 24 icons. `FolderTree` renders the icon as a picker trigger; `NotesShell` persists a pick through `PATCH /api/folders/[id]`.

**Tech Stack:** Next.js 16, React 19, TypeScript 6 strict, Prisma 7 (`runtime = "bun"`), PostgreSQL 16, `lucide-react`, Vitest + jsdom + @testing-library/react, TailwindCSS 4, next-intl, Zod.

**Spec:** `docs/superpowers/specs/2026-05-17-folder-icons-design.md`

**Conventions:** TDD where a task specifies a test. TypeScript strict (no `any` without a `// reason:` comment). Conventional Commits. lefthook pre-commit MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root. Component tests opt into jsdom with a `// @vitest-environment jsdom` pragma on line 1. Commit directly to `main` (trunk-based, user-consented). Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**Notes on two deliberate refinements over the spec:**
1. **The picker is portalled.** The spec said the popover is "absolutely positioned within the row". The folders pane is an `overflow-y-auto` container (`Sidebar/index.tsx`), which clips on *both* axes — an in-row popover would be cut off. The picker therefore renders through `createPortal` into `document.body` with `position: fixed`, anchored to the trigger's `getBoundingClientRect()`. Still hand-rolled, still no Radix, no new dependency (`react-dom` is already present).
2. **`handleSetFolderIcon` is patch-then-refetch, not optimistic.** The spec described an optimistic update; this plan mirrors the existing sibling handler `handleRenameFolder` (`await foldersApi.patch(...)` then `await refreshFolders()`) for consistency with the codebase. Same user-visible result; a thrown error still surfaces through `FolderTree`'s `actionError`.

---

## Task 1: Add `lucide-react` and write ADR 0027

**Files:**
- Modify: `apps/web/package.json`
- Create: `docs/adr/0027-lucide-react-icon-library.md`

- [ ] **Step 1: Pin and install `lucide-react`**

Find the latest version, then add it to `apps/web/package.json`:

```bash
npm view lucide-react version
```

In `apps/web/package.json`, add `lucide-react` to the `dependencies` object (alphabetical order), pinned to the **exact** version printed above (no `^`/`~` — the repo pins exact versions). Then install from the repo root:

```bash
bun install
```

Expected: `bun install` completes and `bun.lock` updates.

- [ ] **Step 2: Write ADR 0027**

Create `docs/adr/0027-lucide-react-icon-library.md`:

```markdown
# ADR 0027: lucide-react as the icon library

**Status:** Accepted
**Date:** 2026-05-17

## Context

The notes UI needs icons — the folder-icons feature lets a folder carry a
chosen glyph, and future UI will want icons too. The template had no icon
library and no convention for one. Picking one now, deliberately, avoids each
feature reaching for a different set.

## Decision

Adopt `lucide-react` as the icon library for `apps/web`.

- It is the icon set shadcn/ui (already in the template stack) is built
  around, so it is the path-of-least-surprise choice.
- MIT-licensed — no attribution or copyleft obligation for customer forks.
- Tree-shakeable: icons are named imports, so the bundle cost is proportional
  to the icons actually used, not the ~1500-icon catalogue.

Icons are referenced by a small curated allow-list per feature (see
`apps/web/src/lib/notes/folder-icons.ts` for folders), never by dynamic name
lookup, so the bundler can see every used icon statically.

## Alternatives considered

- **Heroicons** — fine, but not shadcn/ui's native set; two icon vocabularies
  in one app is avoidable churn.
- **Phosphor** — larger, heavier, and again not the shadcn default.
- **Hand-rolled SVGs** — full control, but every icon becomes maintenance and
  the set the folder picker needs (~24) is too many to hand-author well.

## Consequences

- One new runtime dependency in `apps/web`.
- Future icon needs use `lucide-react` too; a different library would need a
  follow-up ADR.
- Curated allow-lists (not dynamic `name → component`) keep tree-shaking
  effective — a convention contributors must follow.

## References

- Spec: `docs/superpowers/specs/2026-05-17-folder-icons-design.md`
- Plan: `docs/superpowers/plans/2026-05-17-folder-icons.md`
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: all 8 packages exit 0 (adding an unused dependency changes nothing yet).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json bun.lock docs/adr/0027-lucide-react-icon-library.md
git commit -m "build(web): add lucide-react; ADR 0027 adopts it as the icon library"
```

---

## Task 2: `Folder.icon` schema column + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_folder_icon/migration.sql` (generated)

- [ ] **Step 1: Add the column to the schema**

In `packages/db/prisma/schema.prisma`, the `Folder` model has a line
`position  Int      @default(0)`. Add an `icon` field immediately after it:

```prisma
  position  Int      @default(0)
  icon      String   @default("folder")
  createdAt DateTime @default(now())
```

- [ ] **Step 2: Generate and apply the migration**

A local PostgreSQL must be running (the dev/test DB at
`postgresql://app:app@localhost:5432/app`). From the repo root:

```bash
cd packages/db && bunx --bun prisma migrate dev --name folder_icon
```

This creates the migration, applies it to the local DB, and regenerates the
Prisma client. Expected: "Your database is now in sync with your schema."

- [ ] **Step 3: Verify the generated migration SQL**

Open the new `packages/db/prisma/migrations/<timestamp>_folder_icon/migration.sql`.
It MUST be exactly this additive statement (no table rewrite, no data loss):

```sql
-- AlterTable
ALTER TABLE "Folder" ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'folder';
```

Postgres backfills existing rows to `'folder'` automatically — no separate
`UPDATE` is needed. If the SQL differs materially, stop and investigate.

- [ ] **Step 4: Verify existing folder tests still pass**

Run: `bun run vitest run apps/web/src/app/api/folders`
Expected: PASS — the new column is additive and no code reads it yet.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Folder.icon column (default 'folder')"
```

---

## Task 3: `folder-icons.ts` — the single source of truth

**Files:**
- Create: `apps/web/src/lib/notes/folder-icons.ts`
- Create: `apps/web/src/lib/notes/folder-icons.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/folder-icons.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLDER_ICON,
  FOLDER_ICONS,
  folderIconSchema,
  isFolderIcon,
} from './folder-icons.ts';

describe('FOLDER_ICONS', () => {
  it('has 24 entries', () => {
    expect(FOLDER_ICONS).toHaveLength(24);
  });

  it('has no duplicates', () => {
    expect(new Set(FOLDER_ICONS).size).toBe(FOLDER_ICONS.length);
  });

  it('includes the default icon', () => {
    expect(FOLDER_ICONS).toContain(DEFAULT_FOLDER_ICON);
  });
});

describe('folderIconSchema', () => {
  it('accepts a known icon key', () => {
    expect(folderIconSchema.safeParse('briefcase').success).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(folderIconSchema.safeParse('not-an-icon').success).toBe(false);
  });
});

describe('isFolderIcon', () => {
  it('is true for a known key', () => {
    expect(isFolderIcon('rocket')).toBe(true);
  });

  it('is false for an unknown key', () => {
    expect(isFolderIcon('rocket-ship')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/folder-icons.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/web/src/lib/notes/folder-icons.ts`:

```ts
import { z } from 'zod';

/**
 * The curated set of folder icons, by Lucide icon name. The array order is the
 * order the picker grid renders. To add an icon: add its Lucide key here, add
 * its component to the map in `FolderIcon.tsx`, and add a `names.<key>` entry
 * to both message catalogues. This module is pure (no React, no lucide-react)
 * so it is safe to import from server code such as the API schemas.
 */
export const FOLDER_ICONS = [
  'folder',
  'folder-open',
  'briefcase',
  'house',
  'user',
  'users',
  'star',
  'archive',
  'inbox',
  'file-text',
  'book-open',
  'graduation-cap',
  'code',
  'rocket',
  'lightbulb',
  'calendar',
  'list-checks',
  'heart',
  'flag',
  'image',
  'music',
  'wallet',
  'globe',
  'mail',
] as const;

/** A folder-icon key — one of the curated set. */
export type FolderIcon = (typeof FOLDER_ICONS)[number];

/** The icon every folder starts with, and the render-time fallback. */
export const DEFAULT_FOLDER_ICON: FolderIcon = 'folder';

/** Zod enum over the curated set — validates the write path (the PATCH body). */
export const folderIconSchema = z.enum(FOLDER_ICONS);

/** Narrowing guard — true when `value` is a known folder-icon key. */
export const isFolderIcon = (value: string): value is FolderIcon =>
  (FOLDER_ICONS as readonly string[]).includes(value);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/folder-icons.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/folder-icons.ts apps/web/src/lib/notes/folder-icons.test.ts
git commit -m "feat(notes): folder-icons module — curated icon set + Zod enum"
```

---

## Task 4: API & data layer carry `icon`

**Files:**
- Modify: `apps/web/src/lib/api/schemas.ts`
- Modify: `apps/web/src/app/api/folders/[id]/route.ts`
- Modify: `apps/web/src/app/api/folders/route.ts`
- Modify: `apps/web/src/lib/notes/folder-tree.ts`
- Modify: `apps/web/src/app/api/folders/[id]/route.test.ts`
- Modify: any test files with `FolderNode` literal fixtures (typecheck reveals them)

- [ ] **Step 1: Write the failing API tests**

In `apps/web/src/app/api/folders/[id]/route.test.ts`, inside the existing
`describe('PATCH /api/folders/[id]', ...)` block, add three tests:

```ts
it('sets a folder icon', async () => {
  const { user } = await makeTestUser();
  setAuthed(user);
  const f = await prisma.folder.create({
    data: { name: 'api-test-icon', ownerId: user.id },
  });
  const res = await PATCH(
    new Request(`http://localhost/api/folders/${f.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: 'rocket' }),
    }),
    { params: Promise.resolve({ id: f.id }) },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { icon: string };
  expect(body.icon).toBe('rocket');
  const reloaded = await prisma.folder.findUnique({ where: { id: f.id } });
  expect(reloaded?.icon).toBe('rocket');
});

it('rejects an unknown icon key with 400', async () => {
  const { user } = await makeTestUser();
  setAuthed(user);
  const f = await prisma.folder.create({
    data: { name: 'api-test-bad-icon', ownerId: user.id },
  });
  const res = await PATCH(
    new Request(`http://localhost/api/folders/${f.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: 'definitely-not-an-icon' }),
    }),
    { params: Promise.resolve({ id: f.id }) },
  );
  expect(res.status).toBe(400);
});

it('forbids an icon change for a view-only collaborator', async () => {
  // A user with only VIEW access to someone else's folder gets 403.
  // Mirror the existing non-editor PATCH test in this file (the one that
  // asserts 403 for a rename by a VIEW-level collaborator): copy its
  // owner/collaborator/share setup verbatim, change only the request body to
  // `{ icon: 'star' }`, and keep the `expect(res.status).toBe(403)`. If no
  // such non-editor PATCH test exists, build the VIEW share using the helper
  // in `apps/web/src/lib/api/test-session.ts` that the folder-share tests use.
});
```

Replace the third test's comment body with the real setup as instructed
before running — it is the one place that depends on an existing repo helper.

- [ ] **Step 2: Run the API tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/folders/[id]/route.test.ts`
Expected: FAIL — `icon` is not yet accepted (the icon comes back `undefined`,
the bad-key request is currently accepted, etc.).

- [ ] **Step 3: Add `icon` to the schemas**

In `apps/web/src/lib/api/schemas.ts`:

Add an import near the other `@/lib/notes` / local imports:

```ts
import { folderIconSchema } from '@/lib/notes/folder-icons.ts';
```

In the `FolderNode` type, add an `icon` field:

```ts
export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  icon: string;
  createdAt: string;
  updatedAt: string;
  shareCount: number;
};
```

In `patchFolderSchema`, add an optional `icon` field (the `.refine` stays):

```ts
export const patchFolderSchema = z
  .object({
    name: z.string().min(1).max(FOLDER_NAME_MAX).optional(),
    parentId: cuidSchema.nullable().optional(),
    position: z.number().int().min(0).optional(),
    icon: folderIconSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
```

- [ ] **Step 4: Thread `icon` through `[id]/route.ts`**

In `apps/web/src/app/api/folders/[id]/route.ts`:

In the `toNode` helper, add `icon: string` to the parameter type and
`icon: f.icon` to the returned object:

```ts
const toNode = (f: {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  icon: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { shares: number };
}): FolderNode => ({
  id: f.id,
  name: f.name,
  parentId: f.parentId,
  position: f.position,
  icon: f.icon,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
  shareCount: f._count.shares,
});
```

In the `prisma.folder.update` call, add the `icon` write to `data` and
`icon: true` to `select`:

```ts
  const updated = await prisma.folder.update({
    where: { id },
    data: {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.parentId === undefined ? {} : { parentId: parsed.data.parentId }),
      ...(parsed.data.position === undefined ? {} : { position: parsed.data.position }),
      ...(parsed.data.icon === undefined ? {} : { icon: parsed.data.icon }),
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      position: true,
      icon: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { shares: { where: activeShareWhere } } },
    },
  });
```

- [ ] **Step 5: Thread `icon` through `route.ts` (GET + POST)**

In `apps/web/src/app/api/folders/route.ts`:

Update its `toNode` helper identically to Step 4 (add `icon: string` to the
param type, `icon: f.icon` to the return).

Add `icon: true` to the `select` in the GET `prisma.folder.findMany` call and
to the `select` in the POST `prisma.folder.create` call. Do **not** add `icon`
to the POST `create` `data` — new folders take the schema default `'folder'`.

- [ ] **Step 6: Thread `icon` through `folder-tree.ts`**

In `apps/web/src/lib/notes/folder-tree.ts`, the `flatten` function builds each
`FlatFolder` with an explicit object literal. `FlatFolder` is
`FolderNode & { depth; hasChildren }`, so it now requires `icon`. Add
`icon: node.icon,` to that literal:

```ts
    out.push({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      position: node.position,
      icon: node.icon,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      shareCount: node.shareCount,
      depth,
      hasChildren: node.children.length > 0,
    });
```

(`buildFolderTree` uses `{ ...f, children: [] }` — a spread — so it needs no
change.)

- [ ] **Step 7: Run the API tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/folders/[id]/route.test.ts`
Expected: PASS, including the three new tests.

- [ ] **Step 8: Fix `FolderNode` fixture fallout**

`FolderNode` now has a required `icon`. Every test that builds a `FolderNode`
object literal without `icon` will fail typecheck.

Run: `bun run typecheck`

For every error of the form `Property 'icon' is missing in type '{ ... }'`
where the expected type is `FolderNode` (or `FlatFolder`), add `icon: 'folder',`
to that object literal. Re-run `bun run typecheck` until all 8 packages exit 0.
Likely files: `apps/web/src/lib/notes/folder-tree.test.ts` and any component
test with folder fixtures — fix each one the typecheck flags, no more.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/api/schemas.ts \
        apps/web/src/app/api/folders \
        apps/web/src/lib/notes/folder-tree.ts
git commit -m "feat(notes): folders API persists and returns icon"
```

(Include any fixture files touched in Step 8 in the `git add`.)

---

## Task 5: `FolderIcon` — the renderer component

**Files:**
- Create: `apps/web/src/components/notes/Sidebar/FolderIcon.tsx`
- Create: `apps/web/src/components/notes/Sidebar/FolderIcon.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/Sidebar/FolderIcon.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderIcon } from './FolderIcon.tsx';

afterEach(cleanup);

describe('FolderIcon', () => {
  it('renders the svg for a known icon key', () => {
    const { container } = render(<FolderIcon icon="rocket" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('lucide-rocket')).toBe(true);
  });

  it('falls back to the folder icon for an unknown key', () => {
    const { container } = render(<FolderIcon icon="bogus-key" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('lucide-folder')).toBe(true);
  });

  it('passes className through to the svg', () => {
    const { container } = render(
      <FolderIcon icon="folder" className="size-4 text-accent" />,
    );
    expect(container.querySelector('svg')?.classList.contains('size-4')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderIcon.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/notes/Sidebar/FolderIcon.tsx`:

```tsx
import {
  Archive,
  BookOpen,
  Briefcase,
  Calendar,
  Code,
  FileText,
  Flag,
  Folder,
  FolderOpen,
  Globe,
  GraduationCap,
  Heart,
  House,
  Image,
  Inbox,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Mail,
  Music,
  Rocket,
  Star,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { type FolderIcon as FolderIconKey, isFolderIcon } from '@/lib/notes/folder-icons.ts';

/** Curated key → Lucide component. Named imports keep the bundle tree-shaken. */
const ICON_COMPONENTS: Record<FolderIconKey, LucideIcon> = {
  folder: Folder,
  'folder-open': FolderOpen,
  briefcase: Briefcase,
  house: House,
  user: User,
  users: Users,
  star: Star,
  archive: Archive,
  inbox: Inbox,
  'file-text': FileText,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  code: Code,
  rocket: Rocket,
  lightbulb: Lightbulb,
  calendar: Calendar,
  'list-checks': ListChecks,
  heart: Heart,
  flag: Flag,
  image: Image,
  music: Music,
  wallet: Wallet,
  globe: Globe,
  mail: Mail,
};

type Props = {
  /** A folder-icon key. An unrecognised value falls back to the folder icon. */
  icon: string;
  /** Extra classes for the rendered SVG (size, colour). */
  className?: string;
};

/**
 * Renders a folder's Lucide icon from its stored key. Presentational and
 * `aria-hidden` — the accessible name comes from the surrounding control.
 */
export function FolderIcon({ icon, className }: Props) {
  const key: FolderIconKey = isFolderIcon(icon) ? icon : 'folder';
  const Glyph = ICON_COMPONENTS[key];
  return <Glyph aria-hidden="true" className={className} />;
}
```

If `bun run typecheck` reports that `House` is not exported by the installed
`lucide-react`, use `Home` instead (older Lucide versions name it `Home`) and
keep the map key `house`.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderIcon.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/FolderIcon.tsx \
        apps/web/src/components/notes/Sidebar/FolderIcon.test.tsx
git commit -m "feat(notes): FolderIcon — renders a folder's Lucide glyph"
```

---

## Task 6: `FolderIconPicker` popover + i18n

**Files:**
- Create: `apps/web/src/components/notes/Sidebar/FolderIconPicker.tsx`
- Create: `apps/web/src/components/notes/Sidebar/FolderIconPicker.test.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`

- [ ] **Step 1: Add the i18n keys**

In `apps/web/messages/en.json`, inside the `notes` object, add a `folderIcons`
key immediately **after** the `folderActions` object (mind the JSON commas):

```json
    "folderIcons": {
      "pickerLabel": "Change folder icon",
      "names": {
        "folder": "Folder",
        "folder-open": "Open folder",
        "briefcase": "Briefcase",
        "house": "House",
        "user": "Person",
        "users": "People",
        "star": "Star",
        "archive": "Archive",
        "inbox": "Inbox",
        "file-text": "Document",
        "book-open": "Book",
        "graduation-cap": "Education",
        "code": "Code",
        "rocket": "Rocket",
        "lightbulb": "Idea",
        "calendar": "Calendar",
        "list-checks": "Checklist",
        "heart": "Heart",
        "flag": "Flag",
        "image": "Image",
        "music": "Music",
        "wallet": "Wallet",
        "globe": "Globe",
        "mail": "Mail"
      }
    },
```

In `apps/web/messages/de.json`, add the same key in the same place with German
values:

```json
    "folderIcons": {
      "pickerLabel": "Ordnersymbol ändern",
      "names": {
        "folder": "Ordner",
        "folder-open": "Offener Ordner",
        "briefcase": "Aktentasche",
        "house": "Haus",
        "user": "Person",
        "users": "Personen",
        "star": "Stern",
        "archive": "Archiv",
        "inbox": "Posteingang",
        "file-text": "Dokument",
        "book-open": "Buch",
        "graduation-cap": "Bildung",
        "code": "Code",
        "rocket": "Rakete",
        "lightbulb": "Idee",
        "calendar": "Kalender",
        "list-checks": "Checkliste",
        "heart": "Herz",
        "flag": "Flagge",
        "image": "Bild",
        "music": "Musik",
        "wallet": "Geldbörse",
        "globe": "Globus",
        "mail": "Post"
      }
    },
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/notes/Sidebar/FolderIconPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderIconPicker } from './FolderIconPicker.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    folderIcons: {
      pickerLabel: 'Change folder icon',
      names: {
        folder: 'Folder',
        'folder-open': 'Open folder',
        briefcase: 'Briefcase',
        house: 'House',
        user: 'Person',
        users: 'People',
        star: 'Star',
        archive: 'Archive',
        inbox: 'Inbox',
        'file-text': 'Document',
        'book-open': 'Book',
        'graduation-cap': 'Education',
        code: 'Code',
        rocket: 'Rocket',
        lightbulb: 'Idea',
        calendar: 'Calendar',
        'list-checks': 'Checklist',
        heart: 'Heart',
        flag: 'Flag',
        image: 'Image',
        music: 'Music',
        wallet: 'Wallet',
        globe: 'Globe',
        mail: 'Mail',
      },
    },
  },
};

const RECT = { bottom: 120, left: 40, top: 100, right: 56 } as DOMRect;

const renderPicker = (current = 'briefcase') => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FolderIconPicker anchorRect={RECT} current={current} onPick={onPick} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  return { onPick, onClose, dialog };
};

describe('FolderIconPicker', () => {
  it('renders a button for each of the 24 curated icons', () => {
    const { dialog } = renderPicker();
    expect(dialog.querySelectorAll('button[data-icon]')).toHaveLength(24);
  });

  it('marks the current icon active', () => {
    const { dialog } = renderPicker('rocket');
    const active = dialog.querySelector('button[data-active="true"]');
    expect(active?.getAttribute('data-icon')).toBe('rocket');
  });

  it('calls onPick with the chosen icon key', () => {
    const { dialog, onPick } = renderPicker();
    const star = dialog.querySelector('button[data-icon="star"]') as HTMLButtonElement;
    fireEvent.click(star);
    expect(onPick).toHaveBeenCalledWith('star');
  });

  it('closes on Escape', () => {
    const { dialog, onClose } = renderPicker();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on an outside pointerdown', async () => {
    const { onClose } = renderPicker();
    await new Promise((r) => setTimeout(r, 0)); // let the deferred listener attach
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus with ArrowRight', () => {
    const { dialog } = renderPicker('folder');
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button[data-icon]')];
    buttons[0].focus();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderIconPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

Create `apps/web/src/components/notes/Sidebar/FolderIconPicker.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FOLDER_ICONS, type FolderIcon as FolderIconKey } from '@/lib/notes/folder-icons.ts';
import { FolderIcon } from './FolderIcon.tsx';

type Props = {
  /** The trigger's bounding rect — the popover anchors below it. */
  anchorRect: DOMRect;
  /** The folder's current icon key — its grid cell is marked active. */
  current: string;
  onPick: (icon: FolderIconKey) => void;
  onClose: () => void;
};

/** Grid width — 6 columns. Used for vertical arrow-key navigation. */
const COLUMNS = 6;

/**
 * A small popover grid of the curated folder icons. Hand-rolled (no Radix):
 * it portals into `document.body` and positions itself `fixed` at the
 * trigger's rect, so the sidebar's `overflow-y-auto` cannot clip it. Closes on
 * Escape, an outside pointer-down, or a scroll/resize that would move the
 * anchor; arrow keys move focus across the grid.
 */
export function FolderIconPicker({ anchorRect, current, onPick, onClose }: Props) {
  const t = useTranslations('notes.folderIcons');
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the active icon (or the first) when the popover opens.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const active = panel.querySelector<HTMLButtonElement>('button[data-active="true"]');
    const first = panel.querySelector<HTMLButtonElement>('button[data-icon]');
    (active ?? first)?.focus();
  }, []);

  // Close on an outside pointer-down. Deferred one tick so the click that
  // opened the popover does not immediately close it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  // The anchor moves if the page scrolls or resizes — close rather than chase.
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    const delta =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? COLUMNS
            : e.key === 'ArrowUp'
              ? -COLUMNS
              : 0;
    if (delta === 0) return;
    e.preventDefault();
    const panel = panelRef.current;
    if (panel === null) return;
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button[data-icon]')];
    const here = buttons.findIndex((b) => b === document.activeElement);
    buttons[here + delta]?.focus();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('pickerLabel')}
      onKeyDown={onKeyDown}
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      className="border-paper-line/80 bg-background fixed z-50 grid w-[232px] grid-cols-6 gap-1 rounded-lg border p-2 shadow-lg"
    >
      {FOLDER_ICONS.map((key) => {
        const isActive = key === current;
        return (
          <button
            key={key}
            type="button"
            data-icon={key}
            data-active={isActive}
            aria-label={t(`names.${key}`)}
            aria-pressed={isActive}
            onClick={() => onPick(key)}
            className={`inline-flex aspect-square items-center justify-center rounded transition-colors ${
              isActive ? 'bg-accent-soft/60 ring-accent ring-1' : 'hover:bg-muted/60'
            }`}
          >
            <FolderIcon icon={key} className="h-4 w-4" />
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderIconPicker.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/FolderIconPicker.tsx \
        apps/web/src/components/notes/Sidebar/FolderIconPicker.test.tsx \
        apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(notes): FolderIconPicker popover + folderIcons i18n"
```

---

## Task 7: Wire the icon + picker into `FolderTree`

**Files:**
- Modify: `apps/web/src/components/notes/Sidebar/FolderTree.tsx`
- Modify/Create: `apps/web/src/components/notes/Sidebar/FolderTree.test.tsx`

- [ ] **Step 1: Write the failing tests**

Open `apps/web/src/components/notes/Sidebar/FolderTree.test.tsx` (create it if
absent, mirroring the jsdom + `NextIntlClientProvider` harness used by
`apps/web/src/components/notes/NotesShell.test.tsx` — `// @vitest-environment
jsdom` on line 1, an `afterEach(cleanup)`, and a `messages` object that
includes the `notes.folderIcons` and `notes.folderActions` namespaces).

Add a `describe('FolderTree — folder icons', ...)` block. It renders
`<FolderTree>` with a small `folders` fixture (each `FolderNode` literal MUST
include `icon` — e.g. `icon: 'briefcase'`) and a `mutations` object. Cover:

```tsx
it('renders an icon button for each folder when mutations.onSetIcon is given', () => {
  // render FolderTree with mutations including onSetIcon: vi.fn()
  // assert: a button with aria-label "Change folder icon" exists per folder
});

it('opens the picker when the icon button is clicked, without selecting the folder', () => {
  // click the icon button
  // assert: a [role="dialog"] appears in document.body
  // assert: onSelect was NOT called
});

it('renders the icon without a button when the tree is read-only', () => {
  // render FolderTree with NO mutations
  // assert: no "Change folder icon" button; an svg icon is still present
});

it('calls onSetIcon when an icon is picked', async () => {
  // open the picker, click the [data-icon="rocket"] cell
  // assert: mutations.onSetIcon called with (folderId, 'rocket')
});
```

Fill each test body using the harness conventions. The icon button is found by
its `aria-label` (`notes.folderIcons.pickerLabel` → "Change folder icon"); the
picker dialog and its cells are queried from `document.body` (the picker
portals there). Stub `HTMLElement.prototype.scrollIntoView`/`setPointerCapture`
in `beforeEach` only if a test triggers them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderTree.test.tsx`
Expected: FAIL — no icon button is rendered yet.

- [ ] **Step 3: Extend `FolderMutationHandlers`**

In `apps/web/src/components/notes/Sidebar/FolderTree.tsx`, add an import for
the icon key type and the two new components at the top of the file (with the
other imports):

```ts
import type { FolderIcon as FolderIconKey } from '@/lib/notes/folder-icons.ts';
import { FolderIcon } from './FolderIcon.tsx';
import { FolderIconPicker } from './FolderIconPicker.tsx';
```

Add an optional `onSetIcon` to `FolderMutationHandlers` (optional, like
`onReorder` — when absent, the icon is not interactive):

```ts
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
  /** Set folder `id`'s icon. When omitted, the icon is not a picker trigger. */
  onSetIcon?: (id: string, icon: FolderIconKey) => Promise<void>;
};
```

- [ ] **Step 4: Add picker state and handler to the `FolderTree` component**

In the `FolderTree` function body, near the other `useState` calls, add state
for the single open picker (it stores the folder id and the trigger's rect):

```ts
const [iconPicker, setIconPicker] = useState<{ folderId: string; rect: DOMRect } | null>(null);
```

Add a handler that commits a pick. Place it next to the existing rename/delete
handlers that set `actionError` (reuse the same `setActionError` state):

```ts
const handlePickIcon = async (icon: FolderIconKey) => {
  const picker = iconPicker;
  if (picker === null || mutations?.onSetIcon === undefined) return;
  setIconPicker(null);
  try {
    await mutations.onSetIcon(picker.folderId, icon);
  } catch (err) {
    setActionError(err instanceof Error ? err.message : 'icon update failed');
  }
};
```

If the component's error state is not named `actionError` / `setActionError`,
use whatever the existing rename/delete failure path uses — read the component
to confirm the exact name.

- [ ] **Step 5: Pass icon props to each `FolderRow`**

Where `FolderTree` renders `<FolderRow ... />`, add three props:

```tsx
            onOpenIconPicker={
              mutations?.onSetIcon
                ? (rect: DOMRect) => setIconPicker({ folderId: row.id, rect })
                : undefined
            }
```

(`row` is the `FlatFolder` already in scope for that `<FolderRow>`. The row
reads its icon from `row.icon`.)

- [ ] **Step 6: Render the picker once, at the `FolderTree` level**

Next to where `FolderTree` renders its `actionError` alert (near the end of its
JSX), render the single picker:

```tsx
{iconPicker && mutations?.onSetIcon ? (
  <FolderIconPicker
    anchorRect={iconPicker.rect}
    current={folders.find((f) => f.id === iconPicker.folderId)?.icon ?? 'folder'}
    onPick={(icon) => void handlePickIcon(icon)}
    onClose={() => setIconPicker(null)}
  />
) : null}
```

- [ ] **Step 7: Render the icon trigger in `FolderRow`**

Add `onOpenIconPicker` to the `RowProps` type:

```ts
  /** When provided, the folder icon is a button that opens the icon picker. */
  onOpenIconPicker?: ((rect: DOMRect) => void) | undefined;
```

Add it to the `FolderRow` function's destructured parameters.

In `FolderRow`, the render has the chevron block (`{row.hasChildren ? <button…/>
: <span … h-4 w-4 />}`) followed by the rename/name block (`{isRenaming &&
onCommitRename … ? <RenameInput/> : <span …>{row.name}</span>}`). Insert the
icon **between** those two blocks:

```tsx
      {onOpenIconPicker ? (
        <button
          type="button"
          aria-label={tIcons('pickerLabel')}
          title={tIcons('pickerLabel')}
          onClick={(e) => {
            e.stopPropagation();
            onOpenIconPicker(e.currentTarget.getBoundingClientRect());
          }}
          className="hover:ring-accent inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:ring-1"
        >
          <FolderIcon icon={row.icon} className="h-4 w-4" />
        </button>
      ) : (
        <FolderIcon icon={row.icon} className="h-4 w-4 shrink-0" />
      )}
```

`FolderRow` already calls `useTranslations` for `notes.folderActions` (`t`) and
`notes.share` (`tShare`). Add one more, next to them:

```ts
  const tIcons = useTranslations('notes.folderIcons');
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderTree.test.tsx`
Expected: PASS, including the new icon tests.

- [ ] **Step 9: Verify the wider notes suite + typecheck**

Run: `bun run vitest run apps/web/src/components/notes apps/web/src/lib/notes`
Expected: PASS.
Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/FolderTree.tsx \
        apps/web/src/components/notes/Sidebar/FolderTree.test.tsx
git commit -m "feat(notes): folder rows show a clickable icon that opens the picker"
```

---

## Task 8: Wire `handleSetFolderIcon` through `NotesShell` and `Sidebar`

**Files:**
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`

- [ ] **Step 1: Add `handleSetFolderIcon` to `NotesShell`**

In `apps/web/src/components/notes/NotesShell.tsx`, add an import for the icon
key type near the other type imports:

```ts
import type { FolderIcon } from '@/lib/notes/folder-icons.ts';
```

Next to `handleRenameFolder` (mirror its patch-then-refetch shape), add:

```ts
const handleSetFolderIcon = useCallback(
  async (id: string, icon: FolderIcon) => {
    await foldersApi.patch(id, { icon });
    await refreshFolders();
  },
  [refreshFolders],
);
```

In the `folderMutations` object passed to `<Sidebar>`, add `onSetIcon`:

```tsx
folderMutations={{
  onCreate: handleCreateFolder,
  onRename: handleRenameFolder,
  onDelete: handleDeleteFolder,
  onReorder: handleReorderFolders,
  onSetIcon: handleSetFolderIcon,
}}
```

- [ ] **Step 2: Pass `onSetIcon` through `Sidebar`**

In `apps/web/src/components/notes/Sidebar/index.tsx`, the `<FolderTree>` element
builds a `mutations` object from `folderMutations`. Add `onSetIcon` to it,
spread conditionally like `onReorder`:

```tsx
      {...(folderMutations
        ? {
            mutations: {
              onRename: folderMutations.onRename,
              onDelete: folderMutations.onDelete,
              ...(folderMutations.onReorder
                ? { onReorder: folderMutations.onReorder }
                : {}),
              ...(folderMutations.onSetIcon
                ? { onSetIcon: folderMutations.onSetIcon }
                : {}),
            },
          }
        : {})}
```

`Sidebar`'s `Props` type declares `folderMutations?: FolderMutationHandlers &
{ onCreate: ... }`; `FolderMutationHandlers` now carries the optional
`onSetIcon`, so the type flows with no further change.

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: all 8 packages exit 0. If a `folderMutations` test fixture (in
`Sidebar` or `NotesShell` tests) now needs no change — `onSetIcon` is optional,
so existing fixtures still typecheck. Fix only what typecheck flags.
Run: `bun run vitest run apps/web/src/components/notes`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notes/NotesShell.tsx \
        apps/web/src/components/notes/Sidebar/index.tsx
git commit -m "feat(notes): persist folder icon changes from NotesShell"
```

---

## Task 9: Full verification

**Files:** none expected (`vitest.config.ts` only if a coverage gap appears).

- [ ] **Step 1: Full test suite**

Run: `bun run vitest run`
Expected: every test file passes. The new files —
`apps/web/src/lib/notes/folder-icons.ts`, `.../Sidebar/FolderIcon.tsx`,
`.../Sidebar/FolderIconPicker.tsx` — fall under the existing
`apps/web/src/lib/notes/**/*.ts` and `apps/web/src/components/notes/**` coverage
globs in `vitest.config.ts`; no config change is expected. `FolderTree.tsx` is
already in the explicit `include` list. If the coverage gate fails for a
genuinely new file, add it to `include` and re-run.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 3: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. This also confirms `lucide-react`'s named imports tree-shake
cleanly. If it fails, fix the reported file and re-run Steps 1–3.

- [ ] **Step 4: Commit (only if a coverage-config change was needed)**

```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for folder-icons files"
```

Otherwise nothing to commit.

---

## Self-Review

**Spec coverage:**
- Curated `lucide-react` icon set → Task 1 (dep) + Task 3 (`FOLDER_ICONS`).
- ADR for the new dependency → Task 1 (ADR 0027).
- `Folder.icon` non-null column, additive migration → Task 2.
- Single source of truth (`folder-icons.ts`, Zod enum) → Task 3.
- `FolderIcon` renderer with fallback → Task 5.
- Hand-rolled picker popover, 24-icon grid, keyboard, current ringed → Task 6.
- Click-the-icon trigger, one picker open at a time, read-only renders plain
  icon, errors via `actionError` → Task 7.
- `PATCH /api/folders/[id]` accepts `icon` (strict enum, 400 on bad key, 403
  for view-only), `FolderNode.icon`, serializers → Task 4.
- `handleSetFolderIcon`, threaded through `NotesShell`/`Sidebar` → Task 8.
- i18n `notes.folderIcons` (label + 24 names, both locales) → Task 6.
- Turbopack build verification → Task 9.

**Placeholder scan:** The one intentional discovery instruction is Task 4
Step 1's third test (the 403 case), which depends on an existing repo share
helper — it is written as a concrete step with a clear acceptance criterion,
not a vague placeholder. The migration filename timestamp is generated by
Prisma. No "TBD"/"implement later".

**Type consistency:** `FolderIcon` (the key type from `folder-icons.ts`) is
imported as `FolderIconKey` in `FolderIcon.tsx`, `FolderIconPicker.tsx`, and
`FolderTree.tsx` to avoid colliding with the `FolderIcon` component name; in
`NotesShell.tsx` (no component import) it is imported under its own name
`FolderIcon`. `folderIconSchema` is defined in Task 3 and consumed in Task 4
(`patchFolderSchema`). `FolderMutationHandlers.onSetIcon` is
`(id: string, icon: FolderIcon) => Promise<void>` at its Task 7 definition and
matched by `handleSetFolderIcon` (Task 8) and the picker's
`onPick: (icon: FolderIconKey) => void` (Task 6). `FolderNode.icon: string`
(Task 4) flows into `FlatFolder` and is read as `row.icon` in Task 7.

**Deviations from the spec** (documented in the header): the picker is
portalled + `fixed` rather than absolute-in-row (the `overflow-y-auto` sidebar
would clip it); `handleSetFolderIcon` is patch-then-refetch rather than
optimistic (consistency with `handleRenameFolder`).
