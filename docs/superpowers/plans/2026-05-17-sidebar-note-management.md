# Sidebar Note Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create / auto-title / rename / duplicate for notes in the sidebar, and enforce ADR-0026 access on the server-rendered notes pages.

**Architecture:** A new `Note.titleManuallySet` bit lets the editor auto-title a note from its first heading until the user renames it from the sidebar. Duplicate is a server endpoint that deep-copies the note, its tags, and its assets in one transaction. The RSC notes pages reuse the existing `access.ts` engine.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Prisma 7 (`runtime=bun`), PostgreSQL 16, Zod, Vitest (integration tests hit a real Postgres), Bun, TailwindCSS 4 + shadcn/ui, next-intl, Tiptap/Yjs editor.

**Spec:** `docs/superpowers/specs/2026-05-17-sidebar-note-management-design.md`

**Conventions:** TDD (failing test → confirm fail → minimal implementation → confirm pass → commit). Conventional Commits. lefthook pre-commit runs on commit and MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root (never `bun test`; quote paths with `[` brackets). Integration tests hit a real Postgres test DB (already running). `DATABASE_URL` is in `.env.local`. The `timeout` shell command is unavailable on macOS. No `any` without a `// reason:` comment. Commit directly to `main` (trunk-based, user-consented).

---

## Task 1: Delete the seed notes and folders (one-off dev data)

A data-cleanup step — no code, no commit. The dev login authored none of the seed notes; they are owner-locked clutter.

**Files:** none committed (a throwaway script, deleted after).

- [ ] **Step 1: Write the cleanup script**

Create `packages/db/cleanup-seed.ts`:
```ts
import { resolve } from 'node:path';
import dotenv from 'dotenv';
const repoRoot = resolve(import.meta.dirname, '../..');
dotenv.config({ path: [resolve(repoRoot, '.env.local'), resolve(repoRoot, '.env')], quiet: true });
const { prisma } = await import('./src/index.ts');

const seedEmails = [
  'seed@example.invalid',
  'mara.kessler@example.invalid',
  'jonas.albrecht@example.invalid',
];
const seedUsers = await prisma.user.findMany({
  where: { email: { in: seedEmails } },
  select: { id: true },
});
const ids = seedUsers.map((u) => u.id);
const notes = await prisma.note.deleteMany({ where: { authorId: { in: ids } } });
const folders = await prisma.folder.deleteMany({ where: { ownerId: { in: ids } } });
console.log(`deleted ${notes.count} seed notes, ${folders.count} seed folders`);
await prisma.$disconnect();
```

- [ ] **Step 2: Run it**

Run: `cd packages/db && bun cleanup-seed.ts`
Expected: `deleted 8 seed notes, N seed folders` (N is the seed folder count).

- [ ] **Step 3: Delete the script**

Run: `rm packages/db/cleanup-seed.ts`
No commit — this task changes only database rows.

---

## Task 2: `Note.titleManuallySet` — schema, migration, API, types

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<generated>/migration.sql`
- Modify: `apps/web/src/lib/api/schemas.ts`
- Modify: `apps/web/src/app/api/notes/[id]/route.ts`
- Modify: `apps/web/src/app/api/notes/[id]/route.test.ts`
- Modify: `apps/web/src/app/notes/[noteId]/page.tsx` (NoteDetail construction — green-keeping)

- [ ] **Step 1: Edit the schema**

In `packages/db/prisma/schema.prisma`, add to the `Note` model (next to the other scalar fields):
```prisma
  titleManuallySet Boolean @default(false)
```

- [ ] **Step 2: Create the migration**

Run: `cd packages/db && bunx --bun prisma migrate dev --name add_note_title_manually_set --create-only`
Then overwrite the generated `migration.sql` with:
```sql
-- AlterTable
ALTER TABLE "Note" ADD COLUMN "titleManuallySet" BOOLEAN NOT NULL DEFAULT false;

-- Existing notes keep their human-set titles; only notes created after this
-- feature auto-title from the first heading.
UPDATE "Note" SET "titleManuallySet" = true;
```
Apply it: `cd packages/db && bunx --bun prisma migrate dev && bunx --bun prisma generate`
(If `migrate dev` is blocked by the shadow-DB drift check — as has happened with this repo's raw-SQL migrations — apply with `bunx --bun prisma migrate deploy` instead, then `bunx --bun prisma generate`.)

- [ ] **Step 3: Write the failing test**

In `apps/web/src/app/api/notes/[id]/route.test.ts`, append inside the `describe('PATCH /api/notes/[id]', ...)` block:
```ts
it('persists titleManuallySet', async () => {
  const { user } = await makeTestUser();
  setAuthed(user);
  const note = await prisma.note.create({
    data: { title: 'api-test-pin', authorId: user.id },
  });
  const res = await PATCH(
    new Request(`http://localhost/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'api-test-pinned', titleManuallySet: true }),
    }),
    { params: Promise.resolve({ id: note.id }) },
  );
  expect(res.status).toBe(200);
  const reloaded = await prisma.note.findUnique({ where: { id: note.id } });
  expect(reloaded?.titleManuallySet).toBe(true);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `bun run vitest run "apps/web/src/app/api/notes/[id]/route.test.ts"`
Expected: FAIL — `titleManuallySet` is not in `patchNoteSchema`, so it is dropped and the reload shows `false`.

- [ ] **Step 5: Update schemas and the route**

In `apps/web/src/lib/api/schemas.ts`:
- Add `titleManuallySet: boolean` to the `NoteDetail` type.
- In `patchNoteSchema`'s `z.object({...})`, add: `titleManuallySet: z.boolean().optional(),`

In `apps/web/src/app/api/notes/[id]/route.ts`:
- Add `titleManuallySet: true` to the `noteSelect` object.
- In `toDetail`, add `titleManuallySet: boolean` to the input parameter type and `titleManuallySet: n.titleManuallySet` to the returned object.
- In `PATCH`, inside the `prisma.note.update` `data` object, add:
  `...(parsed.data.titleManuallySet === undefined ? {} : { titleManuallySet: parsed.data.titleManuallySet }),`

- [ ] **Step 6: Green-keep the NoteDetail construction sites**

Run `bun run typecheck`. `NoteDetail` gained a required field, so every place that builds a `NoteDetail` now errors. Fix each:
- `apps/web/src/app/notes/[noteId]/page.tsx` — add `titleManuallySet: true` to the `note` `findUnique` `select`, and `titleManuallySet: note.titleManuallySet` to the `initialNote` object.
- Any other site typecheck flags (test fixtures, etc.) — add `titleManuallySet: false`.
Re-run `bun run typecheck` until clean.

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun run vitest run "apps/web/src/app/api/notes/[id]/route.test.ts"`
Expected: PASS (all tests).

- [ ] **Step 8: Commit**

```bash
git add packages/db apps/web/src/lib/api/schemas.ts apps/web/src/app/api/notes apps/web/src/app/notes
git commit -m "feat(notes): Note.titleManuallySet column + PATCH support"
```

---

## Task 3: Enforce ADR-0026 access on the RSC notes pages

**Files:**
- Modify: `apps/web/src/app/notes/page.tsx`
- Modify: `apps/web/src/app/notes/[noteId]/page.tsx`
- Create: `apps/web/src/app/notes/page.test.tsx`
- Create: `apps/web/src/app/notes/[noteId]/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/notes/page.test.tsx`:
```ts
import { vi } from 'vitest';
vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/auth';
import { cleanupNotesDomain, makeTestNote, makeTestUser } from '@/lib/api/test-session.ts';
import Page from './page.tsx';

const mockedAuth = vi.mocked(auth);

const propsOf = (element: unknown): { initialNotes: Array<{ id: string }> } => {
  // Page returns <Suspense><NotesShell .../></Suspense>
  // reason: traversing a React element tree the test constructed indirectly
  const suspense = element as { props: { children: { props: unknown } } };
  return suspense.props.children.props as { initialNotes: Array<{ id: string }> };
};

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /notes page', () => {
  it('excludes notes the user cannot access', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const foreign = await makeTestNote({ authorId: a.id, title: 'api-test-foreign' });
    const mine = await makeTestNote({ authorId: b.id, title: 'api-test-mine' });
    mockedAuth.mockResolvedValue({ user: b } as unknown as Awaited<ReturnType<typeof auth>>);
    const element = await Page();
    const ids = propsOf(element).initialNotes.map((n) => n.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(foreign.id);
  });
});
```

Create `apps/web/src/app/notes/[noteId]/page.test.tsx`:
```ts
import { vi } from 'vitest';
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/auth';
import { cleanupNotesDomain, makeTestNote, makeTestUser } from '@/lib/api/test-session.ts';
import Page from './page.tsx';

const mockedAuth = vi.mocked(auth);

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /notes/[noteId] page', () => {
  it('notFound()s a note the user cannot access', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const foreign = await makeTestNote({ authorId: a.id });
    mockedAuth.mockResolvedValue({ user: b } as unknown as Awaited<ReturnType<typeof auth>>);
    await expect(
      Page({ params: Promise.resolve({ noteId: foreign.id }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders a note the user owns', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    mockedAuth.mockResolvedValue({ user } as unknown as Awaited<ReturnType<typeof auth>>);
    const element = await Page({ params: Promise.resolve({ noteId: note.id }) });
    expect(element).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run vitest run "apps/web/src/app/notes/page.test.tsx" "apps/web/src/app/notes/[noteId]/page.test.tsx"`
Expected: FAIL — the foreign note is included / no `notFound()` is thrown.

- [ ] **Step 3: Enforce access in `app/notes/page.tsx`**

In `apps/web/src/app/notes/page.tsx`, import the engine:
```ts
import { listAccessibleScope } from '@/lib/notes/access.ts';
```
After the `session` check, before the `Promise.all`:
```ts
  const scope = await listAccessibleScope(session.user.id);
```
Change the `folder.findMany` to add `where: { id: { in: scope.accessibleFolderIds } },`.
Change the `note.findMany` `where` to:
```ts
      where: {
        AND: [
          { archivedAt: null },
          {
            OR: [
              { authorId: session.user.id },
              { folderId: { in: scope.accessibleFolderIds } },
              { id: { in: scope.sharedNoteIds } },
            ],
          },
        ],
      },
```

- [ ] **Step 4: Enforce access in `app/notes/[noteId]/page.tsx`**

In `apps/web/src/app/notes/[noteId]/page.tsx`, import:
```ts
import { listAccessibleScope, resolveNoteAccess } from '@/lib/notes/access.ts';
```
After the `session` check, before the `Promise.all`: `const scope = await listAccessibleScope(session.user.id);`
Apply the same `folder.findMany` `where` and `note.findMany` `where` filters as Step 3.
After `if (!note) notFound();`, add:
```ts
  const access = await resolveNoteAccess(session.user.id, noteId);
  if (access === null) notFound();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run vitest run "apps/web/src/app/notes/page.test.tsx" "apps/web/src/app/notes/[noteId]/page.test.tsx"`
Expected: PASS. If the React-element traversal in `propsOf` does not match the actual tree (e.g. `Suspense` nesting differs), adjust the traversal to reach the `NotesShell` props — the assertion target is the `initialNotes` array `NotesShell` receives.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/notes
git commit -m "feat(notes): enforce per-note access on the server-rendered pages"
```

---

## Task 4: Duplicate endpoint + api-client wrapper

**Files:**
- Create: `apps/web/src/app/api/notes/[id]/duplicate/route.ts`
- Create: `apps/web/src/app/api/notes/[id]/duplicate/route.test.ts`
- Modify: `apps/web/src/lib/notes/api-client.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/notes/[id]/duplicate/route.test.ts`. Read `apps/web/src/app/api/notes/[id]/route.test.ts` for the `vi.mock('@/auth')` / `setAuthed` / cleanup pattern. Cover:
- an owner duplicates a note: `201`; the copy is a different id, owned by the caller, titled `"<original> (Kopie)"`, `titleManuallySet === true`, same `folderId`;
- tags are copied (create the source with a tag via `prisma.note.create({ data: { …, tags: { create: { tagId } } } })`, assert the copy has the same tag);
- assets are deep-copied: create an `Asset` on the source (`prisma.asset.create({ data: { noteId, authorId, kind: 'IMAGE', contentType: 'image/png', filename: 'x.png', byteSize: 3, data: Buffer.from([1,2,3]) } })`), put its id into the source note's `body`; after duplicating, the copy has its own `Asset` row (different id, same bytes) and the copy's `body` contains the new asset id and not the old one;
- an unrelated user gets `403`; a missing id gets `404`; an `AuditLog` row with action `notes.duplicated` is written.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run vitest run "apps/web/src/app/api/notes/[id]/duplicate"`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the duplicate route**

Create `apps/web/src/app/api/notes/[id]/duplicate/route.ts`:
```ts
import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, requireSession } from '@/lib/api/responses.ts';
import type { NoteListItem } from '@/lib/api/schemas.ts';
import { resolveNoteAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.notes.duplicate' });
type RouteContext = { params: Promise<{ id: string }> };

const toListItem = (n: {
  id: string;
  title: string;
  folderId: string | null;
  authorId: string;
  archivedAt: Date | null;
  updatedAt: Date;
  tags: Array<{ tag: { id: string; name: string; color: string | null } }>;
}): NoteListItem => ({
  id: n.id,
  title: n.title,
  folderId: n.folderId,
  authorId: n.authorId,
  archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
  updatedAt: n.updatedAt.toISOString(),
  tags: n.tags.map((t) => t.tag),
  shareCount: 0,
});

/** POST /api/notes/[id]/duplicate — deep-copies a note (body, tags, assets). */
export const POST = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const source = await prisma.note.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      body: true,
      folderId: true,
      tags: { select: { tagId: true } },
      assets: {
        select: {
          id: true,
          kind: true,
          contentType: true,
          filename: true,
          caption: true,
          extractedText: true,
          byteSize: true,
          data: true,
          previewImage: true,
          previewContentType: true,
          pageCount: true,
        },
      },
    },
  });
  if (!source) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (access === null) return jsonError(403, 'forbidden');

  return withSpan('notes.duplicate', { 'notes.id': id }, async () => {
    const created = await prisma.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: {
          title: `${source.title} (Kopie)`,
          titleManuallySet: true,
          body: source.body,
          authorId: user.id,
          ...(source.folderId ? { folderId: source.folderId } : {}),
          ...(source.tags.length > 0
            ? { tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) } }
            : {}),
        },
        select: {
          id: true,
          title: true,
          folderId: true,
          authorId: true,
          archivedAt: true,
          updatedAt: true,
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        },
      });

      let body = source.body;
      for (const a of source.assets) {
        const copy = await tx.asset.create({
          data: {
            noteId: note.id,
            authorId: user.id,
            kind: a.kind,
            contentType: a.contentType,
            filename: a.filename,
            caption: a.caption,
            extractedText: a.extractedText,
            byteSize: a.byteSize,
            data: a.data,
            previewImage: a.previewImage,
            previewContentType: a.previewContentType,
            pageCount: a.pageCount,
          },
          select: { id: true },
        });
        // Asset ids are unique cuids — a plain split/join rewrites every
        // reference (image URL + pdf-chip attribute) with no false matches.
        body = body.split(a.id).join(copy.id);
      }
      if (source.assets.length > 0) {
        await tx.note.update({ where: { id: note.id }, data: { body } });
      }
      return note;
    });

    await recordAudit({
      action: 'notes.duplicated',
      actorId: user.id,
      subject: created.id,
      metadata: { sourceId: id },
    });
    log.info({ noteId: created.id, sourceId: id, userId: user.id }, 'note duplicated');
    return jsonCreated(toListItem(created));
  });
};
```

- [ ] **Step 4: Add the api-client wrapper**

In `apps/web/src/lib/notes/api-client.ts`, add to the `notesApi` object (after `putBody`):
```ts
  duplicate: (id: string, fetcher?: typeof fetch): Promise<NoteListItem> =>
    request(`/api/notes/${id}/duplicate`, {
      method: 'POST',
      ...(fetcher ? { fetcher } : {}),
    }),
```
(`NoteListItem` is already imported in this file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run vitest run "apps/web/src/app/api/notes/[id]/duplicate" apps/web/src/lib/notes/api-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Add coverage + commit**

In `vitest.config.ts`, add the duplicate route to the coverage `include` array if no existing glob covers `apps/web/src/app/api/notes/**/route.ts` (check first — one likely already does; if so, no change). Then:
```bash
git add "apps/web/src/app/api/notes/[id]/duplicate" apps/web/src/lib/notes/api-client.ts vitest.config.ts
git commit -m "feat(notes): duplicate endpoint with deep asset copy"
```

---

## Task 5: NotesShell note mutations + sidebar "+" add button + i18n

**Files:**
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/messages/de.json`, `apps/web/messages/en.json`
- Modify: `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Add the i18n keys**

Add to BOTH `apps/web/messages/de.json` and `apps/web/messages/en.json`, under the `notes` object, a new `noteActions` namespace with an identical key set in each (German wording in `de.json`, English in `en.json`):
`newNote`, `renameNote`, `duplicateNote`, `renameNotePlaceholder`.

- [ ] **Step 2: Write the failing test**

In `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`, add a test: render `Sidebar` with a `noteMutations` prop whose `onCreate` is a spy; query the new-note button by its `aria-label` (the `notes.noteActions.newNote` translation — use the same message-provider setup the other Sidebar tests use); click it; assert `onCreate` was called. Match the existing test file's render harness and message stubs.

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: FAIL — there is no new-note button.

- [ ] **Step 4: Add note mutations to `NotesShell`**

In `apps/web/src/components/notes/NotesShell.tsx`:
- Add a module-level constant: `const DEFAULT_NOTE_TITLE = 'Neue Notiz';`
- Add three `useCallback` handlers (place them next to the existing `handleCreateFolder` etc.):
```ts
  const handleCreateNote = useCallback(async () => {
    const created = await notesApi.create({
      title: DEFAULT_NOTE_TITLE,
      ...(folderId !== null ? { folderId } : {}),
    });
    router.push(`/notes/${created.id}${qSuffix(query)}`);
  }, [folderId, router, query]);

  const handleRenameNote = useCallback(async (id: string, title: string) => {
    await notesApi.patch(id, { title, titleManuallySet: true });
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
    setNoteDetail((prev) => (prev && prev.id === id ? { ...prev, title } : prev));
  }, []);

  const handleDuplicateNote = useCallback(
    async (id: string) => {
      const created = await notesApi.duplicate(id);
      router.push(`/notes/${created.id}${qSuffix(query)}`);
    },
    [router, query],
  );
```
- Pass a `noteMutations` prop to `<Sidebar>`:
```tsx
          noteMutations={{
            onCreate: handleCreateNote,
            onRename: handleRenameNote,
            onDuplicate: handleDuplicateNote,
          }}
```

- [ ] **Step 5: Add the `noteMutations` prop + "+" button to `Sidebar`**

In `apps/web/src/components/notes/Sidebar/index.tsx`:
- Add to the `Props` type:
```ts
  noteMutations?: {
    onCreate: () => Promise<void>;
    onRename: (id: string, title: string) => Promise<void>;
    onDuplicate: (id: string) => Promise<void>;
  };
```
- Destructure `noteMutations` from props.
- By the "Notizen" heading (`<h3>{t('notesHeading')}</h3>`), wrap the heading + a `+` button in a flex row and render the button when `noteMutations` is set, mirroring the existing folder `+` button (same classes; `aria-label`/`title` from `useTranslations('notes.noteActions')('newNote')`; `onClick={() => void noteMutations.onCreate()}`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: PASS. Run `bun run typecheck` — fix any `NotesShell`/`Sidebar` fixture typecheck fallout.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/notes apps/web/messages
git commit -m "feat(notes): add-note button in the sidebar"
```

---

## Task 6: Sidebar note-row rename + duplicate affordances

**Files:**
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `Sidebar.test.tsx`, add two tests (reuse the harness from Task 5's test):
- rename: render `Sidebar` with `noteMutations` and at least one note; activate the note row's rename control (query by the `notes.noteActions.renameNote` `aria-label`); a text input appears; type a new title and press Enter; assert `noteMutations.onRename` was called with `(noteId, newTitle)`.
- duplicate: activate the row's duplicate control (`notes.noteActions.duplicateNote` `aria-label`); assert `noteMutations.onDuplicate` was called with `(noteId)`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: FAIL — no rename/duplicate controls exist.

- [ ] **Step 3: Implement the row affordances**

In `apps/web/src/components/notes/Sidebar/index.tsx`, in the `notes.map((n) => …)` row render:
- Add component state `const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);` and `const [renameValue, setRenameValue] = useState('');`.
- When `renamingNoteId === n.id`, render a text `<input>` in place of the note-title button — pre-filled with `renameValue`, `aria-label` from `notes.noteActions.renameNote`; Enter commits (`void noteMutations.onRename(n.id, renameValue.trim())` when non-empty, then `setRenamingNoteId(null)`), Escape/blur cancels (`setRenamingNoteId(null)`). Mirror the existing folder-create inline-input behaviour already in this file.
- Otherwise render the existing note button, plus — when `noteMutations` is set — two hover-revealed buttons in the row's action cluster (next to the eye icon): a rename button (`aria-label` `renameNote`; `onClick` → `setRenameValue(n.title); setRenamingNoteId(n.id)`) and a duplicate button (`aria-label` `duplicateNote`; `onClick` → `void noteMutations.onDuplicate(n.id)`). Style them like the existing eye-icon button (low opacity, `group-hover:opacity-100`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: PASS (all tests, including Task 5's).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar
git commit -m "feat(notes): rename + duplicate actions on sidebar note rows"
```

---

## Task 7: Auto-title from the first heading

**Files:**
- Create: `apps/web/src/lib/notes/auto-title.ts`
- Create: `apps/web/src/lib/notes/auto-title.test.ts`
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/auto-title.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { nextAutoTitle } from './auto-title.ts';

describe('nextAutoTitle', () => {
  it('returns the first heading when the title is not manually set', () => {
    expect(nextAutoTitle('My Heading', 'Neue Notiz', false)).toBe('My Heading');
  });

  it('returns null when the title is manually set', () => {
    expect(nextAutoTitle('My Heading', 'Neue Notiz', true)).toBeNull();
  });

  it('returns null when there is no heading', () => {
    expect(nextAutoTitle(undefined, 'Neue Notiz', false)).toBeNull();
    expect(nextAutoTitle('   ', 'Neue Notiz', false)).toBeNull();
  });

  it('returns null when the heading already equals the title', () => {
    expect(nextAutoTitle('Same', 'Same', false)).toBeNull();
  });

  it('trims the heading', () => {
    expect(nextAutoTitle('  Spaced  ', 'Neue Notiz', false)).toBe('Spaced');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/auto-title.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/notes/auto-title.ts`:
```ts
/**
 * Decides the note's next title from its first heading. Returns the new
 * title, or null when nothing should change: the title is manually pinned,
 * there is no heading, or the heading already matches the current title.
 */
export const nextAutoTitle = (
  firstHeading: string | undefined,
  currentTitle: string,
  titleManuallySet: boolean,
): string | null => {
  if (titleManuallySet) return null;
  const heading = firstHeading?.trim() ?? '';
  if (heading.length === 0) return null;
  if (heading === currentTitle) return null;
  return heading;
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/auto-title.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the editor**

In `apps/web/src/components/notes/NotesShell.tsx`:
- Pass two more props to `<NoteEditor>`: `initialTitleManuallySet={noteDetail.titleManuallySet}` and an `onTitleChange` callback:
```tsx
              onTitleChange={(title) => {
                setNoteDetail((prev) => (prev ? { ...prev, title } : prev));
                setNotes((prev) =>
                  prev.map((n) => (n.id === noteDetail.id ? { ...n, title } : n)),
                );
              }}
```

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`:
- `NoteEditor`'s `Props` and the inner `CollaborativeEditor`'s props gain `initialTitleManuallySet: boolean` and `onTitleChange: (title: string) => void`; thread them through (`NoteEditor` passes both to `<CollaborativeEditor>`).
- Add the imports: `import { deriveDocItems } from '@/lib/notes/doc-outline.ts';` and `import { nextAutoTitle } from '@/lib/notes/auto-title.ts';`.
- In `CollaborativeEditor`, add `const [currentTitle, setCurrentTitle] = useState(initialTitle);` and a `useEffect` that runs an interval (2000 ms) — mirroring the existing save-interval effect — which, only while `!initialTitleManuallySet` and `editor` is set, derives the first heading and syncs the title:
```ts
  useEffect(() => {
    if (!editor || initialTitleManuallySet) return;
    const interval = window.setInterval(async () => {
      const heading = deriveDocItems(editor.state.doc, window.location.origin).headings[0]?.text;
      const next = nextAutoTitle(heading, currentTitle, initialTitleManuallySet);
      if (next === null) return;
      try {
        await notesApi.patch(noteId, { title: next });
        setCurrentTitle(next);
        onTitleChange(next);
      } catch {
        // keep the current title; retry on the next tick
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [editor, noteId, currentTitle, initialTitleManuallySet, onTitleChange]);
```

- [ ] **Step 6: Verify**

Run: `bun run vitest run apps/web/src/lib/notes apps/web/src/components/notes`
Expected: PASS. Run `bun run typecheck` — fix any prop-type fallout in `NoteEditor`/`NotesShell` callers and test fixtures.

- [ ] **Step 7: Add coverage + commit**

In `vitest.config.ts`, add `apps/web/src/lib/notes/auto-title.ts` to the coverage `include` array if not already covered by a glob. Then:
```bash
git add apps/web/src/lib/notes/auto-title.ts apps/web/src/lib/notes/auto-title.test.ts apps/web/src/components/notes vitest.config.ts
git commit -m "feat(notes): auto-title a note from its first heading"
```

---

## Task 8: Full verification

**Files:** `vitest.config.ts` (only if coverage gaps are found).

- [ ] **Step 1: Run the full test suite**

Run: `bun run vitest run`
Expected: all test files pass. If the coverage gate (≥ 90 % / ≥ 80 %) fails because a new file is not in `vitest.config.ts`'s `include`, add it and re-run.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 3: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. This catches Turbopack-only parse/compile errors that `vitest` and `tsc` do not (e.g. JSX comment placement). If it fails, fix the reported file and re-run Steps 1–3.

- [ ] **Step 4: Commit any coverage-config change**

If Step 1 required a `vitest.config.ts` edit:
```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for sidebar note management"
```
Otherwise nothing to commit.

---

## Self-Review

**Spec coverage:**
- Schema `Note.titleManuallySet` + migration → Task 2.
- RSC page leak (both pages enforce access) → Task 3.
- Add note (+ button, NotesShell wiring, default title) → Task 5.
- Auto-title from first heading + `titleManuallySet` gating → Task 7.
- Sidebar rename (pins the title) → Tasks 5 (handler) + 6 (UI).
- Duplicate (endpoint, deep asset copy, body rewrite, sidebar button) → Tasks 4 (endpoint) + 5 (handler) + 6 (UI).
- Seed-data cleanup → Task 1.
- `patchNoteSchema` / `NoteDetail` / API changes → Task 2.
- i18n keys → Task 5.
- Turbopack build verification → Task 8.

**Placeholder scan:** No "TBD"/"implement later". Task 5/6 reference the existing Sidebar test harness and folder-row patterns rather than repeating them — intentional, as those patterns are the in-repo conventions to match; the new behaviour (handlers, props, controls) is fully specified.

**Type consistency:** `titleManuallySet` is the field name everywhere (schema, `NoteDetail`, `patchNoteSchema`, the duplicate route, `NoteEditor` prop `initialTitleManuallySet`). `noteMutations` has the same `{ onCreate, onRename, onDuplicate }` shape in `NotesShell` (Task 5) and `Sidebar`'s `Props` (Task 5), consumed unchanged in Task 6. `nextAutoTitle(firstHeading, currentTitle, titleManuallySet)` defined in Task 7 and called with that signature in `NoteEditor`. `notesApi.duplicate(id)` defined in Task 4, used in Task 5's `handleDuplicateNote`.
