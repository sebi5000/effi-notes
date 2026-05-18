# Shared-Resource Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface resources shared with a user in a dedicated "Shared with me" sidebar section, with sharer attribution and an unseen indicator.

**Architecture:** A new `Share.seenAt` column tracks whether the grantee has opened a shared resource. `listAccessibleScope` is extended to return per-direct-share metadata; the folder/note list endpoints attach an optional `sharedWithMe` block to each directly-shared root. The client partitions folders into owned vs shared, renders a read-only "Shared with me" tree + shared-note list, and marks a share seen when the recipient first opens it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Prisma 7 (`runtime = "bun"`), PostgreSQL 16, Vitest + jsdom + @testing-library/react, next-intl, TailwindCSS 4.

**Spec:** `docs/superpowers/specs/2026-05-18-shared-resource-discovery-design.md`

**Conventions:** TDD where a task specifies a test. TypeScript strict (no `any` without a `// reason:` comment). Conventional Commits. lefthook pre-commit MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root; quote paths containing `[id]`. `timeout` is unavailable on macOS. Integration tests hit a real local Postgres. Commit on the feature branch. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 1: `Share.seenAt` schema column + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_share_seen_at/migration.sql` (generated)

- [ ] **Step 1: Add the column**

In `packages/db/prisma/schema.prisma`, the `Share` model has a line `createdAt   DateTime    @default(now())`. Add a `seenAt` field immediately before it:

```prisma
  seenAt      DateTime?
  createdAt   DateTime    @default(now())
```

`seenAt` is nullable — `null` means the grantee has not opened the shared resource.

- [ ] **Step 2: Generate and apply the migration**

A local PostgreSQL must be running. From the repo root:

```bash
cd packages/db && bunx --bun prisma migrate dev --name share_seen_at
```

Expected: "Your database is now in sync with your schema." This creates the migration, applies it, and regenerates the Prisma client.

- [ ] **Step 3: Verify the generated migration SQL**

Open the new `packages/db/prisma/migrations/<timestamp>_share_seen_at/migration.sql`. It MUST be an additive, nullable column — no default, no rewrite:

```sql
-- AlterTable
ALTER TABLE "Share" ADD COLUMN "seenAt" TIMESTAMP(3);
```

If the SQL differs materially, stop and investigate.

- [ ] **Step 4: Verify existing share tests still pass**

Run: `bun run vitest run apps/web/src/app/api/notes/[id]/shares apps/web/src/app/api/folders/[id]/shares`
Expected: PASS — the column is additive and no code reads it yet.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Share.seenAt column"
```

---

## Task 2: `listAccessibleScope` returns direct-share metadata

**Files:**
- Modify: `apps/web/src/lib/notes/access.ts`
- Create/Modify: `apps/web/src/lib/notes/access.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/web/src/lib/notes/access.test.ts` — if it does not exist, create it with this content; if it exists, add the `describe('listAccessibleScope — directShares', …)` block to it (keeping its existing imports/harness).

```ts
import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupNotesDomain,
  makeTestFolder,
  makeTestNote,
  makeTestShare,
  makeTestUser,
} from '@/lib/api/test-session.ts';
import { listAccessibleScope } from './access.ts';

beforeEach(async () => {
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('listAccessibleScope — directShares', () => {
  it('returns share metadata for a folder shared with the user', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: owner.id });
    const share = await makeTestShare({
      folderId: folder.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'EDIT',
    });

    const scope = await listAccessibleScope(grantee.id);
    const ds = scope.directShares.get(folder.id);
    expect(ds).toBeDefined();
    expect(ds?.shareId).toBe(share.id);
    expect(ds?.access).toBe('EDIT');
    expect(ds?.seenAt).toBeNull();
    expect(typeof ds?.sharedByName).toBe('string');
  });

  it('returns share metadata for a directly-shared note', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });

    const scope = await listAccessibleScope(grantee.id);
    const ds = scope.directShares.get(note.id);
    expect(ds?.shareId).toBe(share.id);
    expect(ds?.access).toBe('VIEW');
  });

  it('has an empty directShares map for a user with no shares', async () => {
    const { user } = await makeTestUser();
    const scope = await listAccessibleScope(user.id);
    expect(scope.directShares.size).toBe(0);
  });
});
```

If `makeTestFolder` / `makeTestNote` take different option names, read `apps/web/src/lib/api/test-session.ts` and adjust the calls to the real signatures.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: FAIL — `scope.directShares` does not exist.

- [ ] **Step 3: Extend `access.ts`**

In `apps/web/src/lib/notes/access.ts`:

Add a `DirectShare` type and a `directShares` field to `AccessibleScope`. Replace the existing `AccessibleScope` type with:

```ts
/** Metadata about a single direct Share to the current user. */
export type DirectShare = {
  shareId: string;
  /** The sharer's display name, or their email when no display name is set. */
  sharedByName: string;
  access: 'VIEW' | 'EDIT';
  /** When the grantee first opened the resource, or null if not yet. */
  seenAt: Date | null;
};

export type AccessibleScope = {
  /** Folder ids the user owns or has a share on, plus all descendants. */
  accessibleFolderIds: string[];
  /** Note ids shared directly with the user. */
  sharedNoteIds: string[];
  /** Direct shares to the user, keyed by the shared folder/note id. */
  directShares: Map<string, DirectShare>;
};
```

In `listAccessibleScope`, the two `prisma.share.findMany` calls currently select only `folderId` / `noteId`. Widen both selects and build the map. Replace the `folderShares` and `noteShares` queries with:

```ts
    prisma.share.findMany({
      where: { granteeId: userId, folderId: { not: null }, AND: [activeShareWhere(now)] },
      select: {
        id: true,
        folderId: true,
        access: true,
        seenAt: true,
        createdBy: { select: { displayName: true, email: true } },
      },
    }),
    prisma.share.findMany({
      where: { granteeId: userId, noteId: { not: null }, AND: [activeShareWhere(now)] },
      select: {
        id: true,
        noteId: true,
        access: true,
        seenAt: true,
        createdBy: { select: { displayName: true, email: true } },
      },
    }),
```

The `roots` set still needs the folder ids — `s.folderId` is still selected, so the line `for (const s of folderShares) if (s.folderId !== null) roots.add(s.folderId);` is unchanged.

Before the `return`, build the map:

```ts
  const directShares = new Map<string, DirectShare>();
  for (const s of folderShares) {
    if (s.folderId === null) continue;
    directShares.set(s.folderId, {
      shareId: s.id,
      sharedByName: s.createdBy.displayName ?? s.createdBy.email,
      access: s.access,
      seenAt: s.seenAt,
    });
  }
  for (const s of noteShares) {
    if (s.noteId === null) continue;
    directShares.set(s.noteId, {
      shareId: s.id,
      sharedByName: s.createdBy.displayName ?? s.createdBy.email,
      access: s.access,
      seenAt: s.seenAt,
    });
  }
```

And add `directShares` to the returned object:

```ts
  return {
    accessibleFolderIds: [...accessible],
    sharedNoteIds: noteShares.map((s) => s.noteId).filter((id): id is string => id !== null),
    directShares,
  };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/access.ts apps/web/src/lib/notes/access.test.ts
git commit -m "feat(notes): listAccessibleScope returns direct-share metadata"
```

---

## Task 3: `sharedWithMe` types + API tagging

**Files:**
- Modify: `apps/web/src/lib/api/schemas.ts`
- Modify: `apps/web/src/app/api/folders/route.ts`
- Modify: `apps/web/src/app/api/notes/route.ts`
- Modify: `apps/web/src/app/api/folders/route.test.ts`, `apps/web/src/app/api/notes/route.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/app/api/folders/route.test.ts`, inside the `describe('GET /api/folders', …)` block, add:

```ts
it('tags a folder shared with the user with sharedWithMe', async () => {
  const { user: owner } = await makeTestUser();
  const { user: grantee } = await makeTestUser();
  const folder = await prisma.folder.create({
    data: { name: 'api-test-shared-folder', ownerId: owner.id },
  });
  await makeTestShare({
    folderId: folder.id,
    granteeId: grantee.id,
    createdById: owner.id,
    access: 'EDIT',
  });
  setAuthed(grantee);
  const res = await GET();
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    folders: Array<{ id: string; sharedWithMe?: { access: string; seenAt: string | null } }>;
  };
  const node = body.folders.find((f) => f.id === folder.id);
  expect(node?.sharedWithMe).toBeDefined();
  expect(node?.sharedWithMe?.access).toBe('EDIT');
  expect(node?.sharedWithMe?.seenAt).toBeNull();
});

it('does not tag the owner’s own folder with sharedWithMe', async () => {
  const { user } = await makeTestUser();
  const folder = await prisma.folder.create({
    data: { name: 'api-test-own-folder', ownerId: user.id },
  });
  setAuthed(user);
  const res = await GET();
  const body = (await res.json()) as {
    folders: Array<{ id: string; sharedWithMe?: unknown }>;
  };
  expect(body.folders.find((f) => f.id === folder.id)?.sharedWithMe).toBeUndefined();
});
```

In `apps/web/src/app/api/notes/route.test.ts`, inside `describe('GET /api/notes', …)`, add:

```ts
it('tags a directly-shared note with sharedWithMe', async () => {
  const { user: owner } = await makeTestUser();
  const { user: grantee } = await makeTestUser();
  const note = await prisma.note.create({
    data: { title: 'api-test-shared-note', body: '', authorId: owner.id },
  });
  await makeTestShare({
    noteId: note.id,
    granteeId: grantee.id,
    createdById: owner.id,
    access: 'VIEW',
  });
  setAuthed(grantee);
  const res = await GET(new Request('http://localhost/api/notes'));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    notes: Array<{ id: string; sharedWithMe?: { access: string } }>;
  };
  expect(body.notes.find((n) => n.id === note.id)?.sharedWithMe?.access).toBe('VIEW');
});
```

Both test files import `makeTestShare` — add it to the existing `@/lib/api/test-session.ts` import block if it is not already imported.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/folders/route.test.ts apps/web/src/app/api/notes/route.test.ts`
Expected: FAIL — `sharedWithMe` is never set.

- [ ] **Step 3: Add the `SharedWithMe` type to `schemas.ts`**

In `apps/web/src/lib/api/schemas.ts`, add the type (place it near the share types, after `ShareView`):

```ts
/** Present on a folder/note that is directly shared with the current user. */
export type SharedWithMe = {
  shareId: string;
  sharedByName: string;
  access: 'VIEW' | 'EDIT';
  /** ISO timestamp the grantee first opened the resource, or null. */
  seenAt: string | null;
};
```

Add an optional `sharedWithMe` field to `FolderNode` and to `NoteListItem`:

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
  sharedWithMe?: SharedWithMe;
};
```

```ts
export type NoteListItem = {
  id: string;
  title: string;
  snippet: string;
  folderId: string | null;
  authorId: string;
  archivedAt: string | null;
  updatedAt: string;
  tags: Array<{ id: string; name: string; color: string | null }>;
  shareCount: number;
  sharedWithMe?: SharedWithMe;
};
```

- [ ] **Step 4: Tag in `folders/route.ts`**

In `apps/web/src/app/api/folders/route.ts`:

Add `DirectShare` to the access import and `SharedWithMe` to the schemas import:

```ts
import { type FolderNode, type SharedWithMe, createFolderSchema } from '@/lib/api/schemas.ts';
import { type DirectShare, canEdit, listAccessibleScope, resolveFolderAccess } from '@/lib/notes/access.ts';
```

Add a helper that maps a `DirectShare` to a `SharedWithMe` (ISO conversion), and give `toNode` an optional `directShares` parameter:

```ts
const toSharedWithMe = (ds: DirectShare): SharedWithMe => ({
  shareId: ds.shareId,
  sharedByName: ds.sharedByName,
  access: ds.access,
  seenAt: ds.seenAt === null ? null : ds.seenAt.toISOString(),
});

const toNode = (
  f: {
    id: string;
    name: string;
    parentId: string | null;
    position: number;
    icon: string;
    createdAt: Date;
    updatedAt: Date;
    _count: { shares: number };
  },
  directShares?: Map<string, DirectShare>,
): FolderNode => {
  const ds = directShares?.get(f.id);
  return {
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    position: f.position,
    icon: f.icon,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    shareCount: f._count.shares,
    ...(ds === undefined ? {} : { sharedWithMe: toSharedWithMe(ds) }),
  };
};
```

In the `GET` handler, pass the map: change `folders.map(toNode)` to `folders.map((f) => toNode(f, scope.directShares))`. The `POST` handler's `toNode(created)` call stays unchanged (a freshly-created folder is never shared with its creator).

- [ ] **Step 5: Tag in `notes/route.ts`**

In `apps/web/src/app/api/notes/route.ts`, apply the identical pattern:

Add the imports:
```ts
import { createNoteSchema, listNotesQuerySchema, type NoteListItem, type SharedWithMe } from '@/lib/api/schemas.ts';
import { type DirectShare, canEdit, listAccessibleScope, resolveFolderAccess } from '@/lib/notes/access.ts';
```

Add the same `toSharedWithMe` helper, and give `toListItem` an optional `directShares` parameter — look up `directShares?.get(n.id)` and spread `...(ds === undefined ? {} : { sharedWithMe: toSharedWithMe(ds) })` into the returned object. In the `GET` handler, change `notes.map(toListItem)` to `notes.map((n) => toListItem(n, scope.directShares))`. The `POST` handler's `toListItem(created)` stays unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/folders/route.test.ts apps/web/src/app/api/notes/route.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: all 8 packages exit 0. `sharedWithMe` is optional on `FolderNode`/`NoteListItem`, so existing fixtures need no change.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api/schemas.ts apps/web/src/app/api/folders apps/web/src/app/api/notes
git commit -m "feat(notes): tag shared resources with sharedWithMe in the list APIs"
```

---

## Task 4: `POST /api/shares/[id]/seen` + `sharesApi.markSeen`

**Files:**
- Create: `apps/web/src/app/api/shares/[id]/seen/route.ts`
- Create: `apps/web/src/app/api/shares/[id]/seen/route.test.ts`
- Modify: `apps/web/src/lib/notes/api-client.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/api/shares/[id]/seen/route.test.ts`:

```ts
import { vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/auth';
import {
  authedAs,
  cleanupNotesDomain,
  makeTestNote,
  makeTestShare,
  makeTestUser,
  unauthed,
} from '@/lib/api/test-session.ts';
import { POST } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

const req = () => new Request('http://localhost/api/shares/x/seen', { method: 'POST' });

describe('POST /api/shares/[id]/seen', () => {
  it('returns 401 without a session', async () => {
    setUnauthed();
    const res = await POST(req(), { params: Promise.resolve({ id: 'x' }) });
    expect(res.status).toBe(401);
  });

  it('marks an unseen share seen for its grantee', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(grantee);
    const res = await POST(req(), { params: Promise.resolve({ id: share.id }) });
    expect(res.status).toBe(200);
    const reloaded = await prisma.share.findUnique({ where: { id: share.id } });
    expect(reloaded?.seenAt).not.toBeNull();
  });

  it('is idempotent — a second call still returns 200', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(grantee);
    await POST(req(), { params: Promise.resolve({ id: share.id }) });
    const res = await POST(req(), { params: Promise.resolve({ id: share.id }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 for a non-grantee', async () => {
    const { user: owner } = await makeTestUser();
    const { user: grantee } = await makeTestUser();
    const { user: stranger } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    const share = await makeTestShare({
      noteId: note.id,
      granteeId: grantee.id,
      createdById: owner.id,
      access: 'VIEW',
    });
    setAuthed(stranger);
    const res = await POST(req(), { params: Promise.resolve({ id: share.id }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown share id', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(req(), { params: Promise.resolve({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run "apps/web/src/app/api/shares/[id]/seen/route.test.ts"`
Expected: FAIL — `./route.ts` does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/shares/[id]/seen/route.ts`:

```ts
import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';

const log = createLogger({ component: 'api.shares.seen' });

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Mark a share the current user is the grantee of as "seen". Idempotent —
 * sets `seenAt` only when still null. A non-grantee gets 404 (the share's
 * existence is not revealed).
 */
export const POST = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const share = await prisma.share.findUnique({
    where: { id },
    select: { id: true, granteeId: true, seenAt: true },
  });
  if (!share || share.granteeId !== user.id) return jsonError(404, 'not found');

  if (share.seenAt === null) {
    await prisma.share.update({ where: { id }, data: { seenAt: new Date() } });
    log.info({ shareId: id, userId: user.id }, 'share marked seen');
  }
  return jsonOk({ marked: true });
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run "apps/web/src/app/api/shares/[id]/seen/route.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Add `sharesApi.markSeen`**

In `apps/web/src/lib/notes/api-client.ts`, add a `markSeen` method to the `sharesApi` object (after `revoke`):

```ts
  markSeen: (shareId: string, fetcher?: typeof fetch): Promise<{ marked: true }> =>
    request(`/api/shares/${shareId}/seen`, {
      method: 'POST',
      ...(fetcher ? { fetcher } : {}),
    }),
```

Run `bun run typecheck` — expect all 8 packages exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/shares apps/web/src/lib/notes/api-client.ts
git commit -m "feat(notes): POST /api/shares/[id]/seen mark-seen endpoint"
```

---

## Task 5: `partitionSharedFolders` helper

**Files:**
- Create: `apps/web/src/lib/notes/shared-folders.ts`
- Create: `apps/web/src/lib/notes/shared-folders.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/shared-folders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FolderNode } from '@/lib/api/schemas.ts';
import { partitionSharedFolders } from './shared-folders.ts';

const folder = (id: string, parentId: string | null, shared = false): FolderNode => ({
  id,
  name: id,
  parentId,
  position: 0,
  icon: 'folder',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
  shareCount: 0,
  ...(shared
    ? { sharedWithMe: { shareId: `s-${id}`, sharedByName: 'Alice', access: 'VIEW', seenAt: null } }
    : {}),
});

describe('partitionSharedFolders', () => {
  it('puts owned folders in `own` and shared roots in `shared`', () => {
    const { own, shared } = partitionSharedFolders([
      folder('mine', null),
      folder('theirs', null, true),
    ]);
    expect(own.map((f) => f.id)).toEqual(['mine']);
    expect(shared.map((f) => f.id)).toEqual(['theirs']);
  });

  it('treats a descendant of a shared root as shared', () => {
    const { own, shared } = partitionSharedFolders([
      folder('root', null, true),
      folder('child', 'root'),
      folder('grandchild', 'child'),
    ]);
    expect(own).toHaveLength(0);
    expect(shared.map((f) => f.id).sort()).toEqual(['child', 'grandchild', 'root']);
  });

  it('keeps an owned folder owned even when other folders are shared', () => {
    const { own, shared } = partitionSharedFolders([
      folder('a', null),
      folder('b', null, true),
      folder('b-child', 'b'),
    ]);
    expect(own.map((f) => f.id)).toEqual(['a']);
    expect(shared.map((f) => f.id).sort()).toEqual(['b', 'b-child']);
  });

  it('returns two empty arrays for an empty input', () => {
    const { own, shared } = partitionSharedFolders([]);
    expect(own).toEqual([]);
    expect(shared).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/shared-folders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/notes/shared-folders.ts`:

```ts
import type { FolderNode } from '@/lib/api/schemas.ts';

/**
 * Split a folder list into the user's own folders and the folders reached
 * via a share. A folder belongs to `shared` when it carries `sharedWithMe`
 * (a directly-shared root) or descends from one; everything else is `own`.
 * The walk is cycle-safe.
 */
export const partitionSharedFolders = (
  folders: ReadonlyArray<FolderNode>,
): { own: FolderNode[]; shared: FolderNode[] } => {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const sharedRootIds = new Set(
    folders.filter((f) => f.sharedWithMe !== undefined).map((f) => f.id),
  );

  const isShared = (start: FolderNode): boolean => {
    let current: FolderNode | undefined = start;
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current.id)) {
      if (sharedRootIds.has(current.id)) return true;
      visited.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return false;
  };

  const own: FolderNode[] = [];
  const shared: FolderNode[] = [];
  for (const f of folders) {
    if (isShared(f)) shared.push(f);
    else own.push(f);
  }
  return { own, shared };
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/shared-folders.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/shared-folders.ts apps/web/src/lib/notes/shared-folders.test.ts
git commit -m "feat(notes): partitionSharedFolders — split owned from shared folders"
```

---

## Task 6: `SharedWithMe` component + i18n

**Files:**
- Create: `apps/web/src/components/notes/Sidebar/SharedWithMe.tsx`
- Create: `apps/web/src/components/notes/Sidebar/SharedWithMe.test.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

- [ ] **Step 1: Add the i18n keys**

In `apps/web/messages/en.json`, inside the `notes` object, add a `sharedWithMe` key after the `sidebar` object:

```json
    "sharedWithMe": {
      "heading": "Shared with me",
      "sharedBy": "Shared by {name}",
      "accessView": "View",
      "accessEdit": "Can edit",
      "unseenLabel": "Not opened yet"
    },
```

In `apps/web/messages/de.json`, add the same key with German values:

```json
    "sharedWithMe": {
      "heading": "Mit mir geteilt",
      "sharedBy": "Geteilt von {name}",
      "accessView": "Ansehen",
      "accessEdit": "Bearbeiten",
      "unseenLabel": "Noch nicht geöffnet"
    },
```

Both files must keep an identical key tree.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/notes/Sidebar/SharedWithMe.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderNode, NoteListItem } from '@/lib/api/schemas.ts';
import { SharedWithMe } from './SharedWithMe.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    sharedWithMe: {
      heading: 'Shared with me',
      sharedBy: 'Shared by {name}',
      accessView: 'View',
      accessEdit: 'Can edit',
      unseenLabel: 'Not opened yet',
    },
  },
} as const;

const folder = (id: string, parentId: string | null, share?: Partial<FolderNode['sharedWithMe']>): FolderNode => ({
  id,
  name: id,
  parentId,
  position: 0,
  icon: 'folder',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
  shareCount: 0,
  ...(share
    ? { sharedWithMe: { shareId: `s-${id}`, sharedByName: 'Alice', access: 'EDIT', seenAt: null, ...share } }
    : {}),
});

const note = (id: string, share?: Partial<NoteListItem['sharedWithMe']>): NoteListItem => ({
  id,
  title: id,
  snippet: '',
  folderId: null,
  authorId: 'someone',
  archivedAt: null,
  updatedAt: '2026-05-18T00:00:00.000Z',
  tags: [],
  shareCount: 0,
  ...(share
    ? { sharedWithMe: { shareId: `s-${id}`, sharedByName: 'Bob', access: 'VIEW', seenAt: null, ...share } }
    : {}),
});

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const noop = () => undefined;

describe('SharedWithMe', () => {
  it('renders nothing when there is nothing shared', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    expect(container.querySelector('section')).toBeNull();
  });

  it('renders a shared folder with its sharer attribution', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('clients', null, {})]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    expect(within(container).getByText('clients')).toBeTruthy();
    expect(container.textContent).toContain('Shared by Alice');
    expect(container.textContent).toContain('Can edit');
  });

  it('shows the unseen count for not-yet-opened shares', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('a', null, { seenAt: null })]}
          sharedNotes={[note('n', { seenAt: null })]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    // two unseen shares → the heading shows "2"
    const heading = within(container).getByText('Shared with me').closest('h3');
    expect(heading?.textContent).toContain('2');
  });

  it('selecting a shared folder calls onSelectFolder', () => {
    const onSelectFolder = vi.fn();
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('clients', null, {})]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={onSelectFolder}
          onSelectNote={noop}
        />,
      ),
    );
    fireEvent.click(within(container).getByText('clients'));
    expect(onSelectFolder).toHaveBeenCalledWith('clients');
  });

  it('clicking a shared note calls onSelectNote', () => {
    const onSelectNote = vi.fn();
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[]}
          sharedNotes={[note('roadmap', {})]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={onSelectNote}
        />,
      ),
    );
    fireEvent.click(within(container).getByText('roadmap'));
    expect(onSelectNote).toHaveBeenCalledWith('roadmap');
  });

  it('expands a shared folder to reveal its children', () => {
    const { container } = render(
      wrap(
        <SharedWithMe
          sharedFolders={[folder('root', null, {}), folder('child', 'root')]}
          sharedNotes={[]}
          selectedFolderId={null}
          selectedNoteId={null}
          onSelectFolder={noop}
          onSelectNote={noop}
        />,
      ),
    );
    // child hidden until the root is expanded
    expect(within(container).queryByText('child')).toBeNull();
    fireEvent.click(within(container).getByRole('button', { name: 'Expand' }));
    expect(within(container).getByText('child')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/SharedWithMe.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

Create `apps/web/src/components/notes/Sidebar/SharedWithMe.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FolderNode, NoteListItem, SharedWithMe as Share } from '@/lib/api/schemas.ts';
import { buildFolderTree, type FolderTreeNode } from '@/lib/notes/folder-tree.ts';
import { FolderIcon } from './FolderIcon.tsx';

type Props = {
  /** Shared folder roots and their descendants. */
  sharedFolders: ReadonlyArray<FolderNode>;
  /** Directly-shared notes. */
  sharedNotes: ReadonlyArray<NoteListItem>;
  selectedFolderId: string | null;
  selectedNoteId: string | null;
  onSelectFolder: (id: string) => void;
  onSelectNote: (id: string) => void;
};

/** "Shared by <name> · <access>" attribution line for a shared root. */
function Attribution({ share }: { share: Share }) {
  const t = useTranslations('notes.sharedWithMe');
  return (
    <span className="text-muted-foreground/70">
      {' — '}
      {t('sharedBy', { name: share.sharedByName })} ·{' '}
      {t(share.access === 'EDIT' ? 'accessEdit' : 'accessView')}
    </span>
  );
}

/** A small dot marking a not-yet-opened shared resource. */
function UnseenDot() {
  const t = useTranslations('notes.sharedWithMe');
  return (
    <span
      aria-label={t('unseenLabel')}
      className="bg-accent inline-block h-1.5 w-1.5 shrink-0 rounded-full"
    />
  );
}

/**
 * The "Shared with me" sidebar section: a read-only navigable tree of shared
 * folders and a flat list of directly-shared notes, each attributed to the
 * sharer and dotted while unseen. Renders nothing when nothing is shared.
 */
export function SharedWithMe({
  sharedFolders,
  sharedNotes,
  selectedFolderId,
  selectedNoteId,
  onSelectFolder,
  onSelectNote,
}: Props) {
  const t = useTranslations('notes.sharedWithMe');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (sharedFolders.length === 0 && sharedNotes.length === 0) return null;

  const tree = buildFolderTree(sharedFolders);
  const unseen =
    sharedFolders.filter((f) => f.sharedWithMe?.seenAt === null).length +
    sharedNotes.filter((n) => n.sharedWithMe?.seenAt === null).length;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: FolderTreeNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.id);
    const isSelected = node.id === selectedFolderId;
    const share = node.sharedWithMe;
    return (
      <li key={node.id}>
        <div
          className={`flex items-center gap-1 rounded text-sm ${
            isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground'
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              onClick={() => toggle(node.id)}
              className="text-muted-foreground/60 hover:text-foreground inline-flex h-4 w-4 items-center justify-center text-[10px] leading-none"
            >
              <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            </button>
          ) : (
            <span aria-hidden="true" className="inline-block h-4 w-4" />
          )}
          <button
            type="button"
            onClick={() => onSelectFolder(node.id)}
            aria-current={isSelected ? 'true' : undefined}
            className="hover:bg-muted/60 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left"
          >
            <FolderIcon icon={node.icon} className="h-4 w-4 shrink-0" />
            <span className="font-display truncate">{node.name}</span>
            {share?.seenAt === null ? <UnseenDot /> : null}
          </button>
        </div>
        {share !== undefined ? (
          <div
            className="text-[10px] leading-tight"
            style={{ paddingLeft: `${depth * 14 + 30}px` }}
          >
            <Attribution share={share} />
          </div>
        ) : null}
        {isOpen && node.children.length > 0 ? (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <section aria-label={t('heading')} className="mt-4 flex flex-col">
      <h3 className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
        {t('heading')}
        {unseen > 0 ? (
          <span className="bg-accent inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white">
            {unseen}
          </span>
        ) : null}
      </h3>

      {tree.length > 0 ? <ul>{tree.map((node) => renderNode(node, 0))}</ul> : null}

      {sharedNotes.length > 0 ? (
        <ul className="mt-0.5">
          {sharedNotes.map((n) => {
            const isSelected = n.id === selectedNoteId;
            const share = n.sharedWithMe;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelectNote(n.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`hover:bg-muted/60 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
                    isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <span aria-hidden="true" className="text-xs leading-none">
                    📄
                  </span>
                  <span className="font-display truncate">{n.title}</span>
                  {share?.seenAt === null ? <UnseenDot /> : null}
                </button>
                {share !== undefined ? (
                  <div className="pl-9 text-[10px] leading-tight">
                    <Attribution share={share} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
```

If `buildFolderTree` / `FolderTreeNode` are not exported from `apps/web/src/lib/notes/folder-tree.ts` under those exact names, read that file and use the real export names. `FolderTreeNode` must be `FolderNode & { children: FolderTreeNode[] }` — confirm `sharedWithMe` survives `buildFolderTree` (it spreads `...f`, so it does).

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/SharedWithMe.test.tsx`
Expected: PASS (6 tests).
Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/SharedWithMe.tsx \
        apps/web/src/components/notes/Sidebar/SharedWithMe.test.tsx \
        apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(notes): SharedWithMe sidebar section + i18n"
```

---

## Task 7: Wire `SharedWithMe` into `Sidebar` and `NotesShell`

**Files:**
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/src/components/notes/NotesShell.tsx`

- [ ] **Step 1: Add the props + render in `Sidebar`**

In `apps/web/src/components/notes/Sidebar/index.tsx`:

Add the import:
```ts
import { SharedWithMe } from './SharedWithMe.tsx';
```

Add two optional props to the `Props` type (default to empty so existing callers/tests are unaffected):
```ts
  /** Folders reached via a share — rendered in the "Shared with me" section. */
  sharedFolders?: ReadonlyArray<FolderNode>;
  /** Directly-shared notes — rendered in the "Shared with me" section. */
  sharedNotes?: ReadonlyArray<NoteListItem>;
```

Destructure them in the component signature with defaults: `sharedFolders = []`, `sharedNotes = []`.

Inside the folders `<section>` (the one with `aria-label={t('foldersHeading')}`), after the `<FolderTree>` element and its `createError` block, render the section:

```tsx
            <SharedWithMe
              sharedFolders={sharedFolders}
              sharedNotes={sharedNotes}
              selectedFolderId={selectedFolderId}
              selectedNoteId={selectedNoteId}
              onSelectFolder={onSelectFolder}
              onSelectNote={onSelectNote}
            />
```

(`selectedFolderId`, `selectedNoteId`, `onSelectFolder`, `onSelectNote` are already props of `Sidebar` — confirm their exact names by reading the file and match them.)

- [ ] **Step 2: Partition + wire in `NotesShell`**

In `apps/web/src/components/notes/NotesShell.tsx`:

Add imports:
```ts
import { partitionSharedFolders } from '@/lib/notes/shared-folders.ts';
import { sharesApi } from '@/lib/notes/api-client.ts';
```
(`sharesApi` may already be imported alongside `notesApi`/`foldersApi` — if so, do not duplicate the import; just ensure `sharesApi` is included.)

After the `folders` and `notes` state are declared, derive the partitions with `useMemo`:

```ts
  const { own: ownFolders, shared: sharedFolders } = useMemo(
    () => partitionSharedFolders(folders),
    [folders],
  );
  const sharedNotes = useMemo(() => notes.filter((n) => n.sharedWithMe !== undefined), [notes]);
  const ownNotes = useMemo(() => notes.filter((n) => n.sharedWithMe === undefined), [notes]);
```

Ensure `useMemo` is imported from `react`.

Find the `<Sidebar>` element. Change the `folders` prop to pass `ownFolders`, change the `notes` prop to pass `ownNotes`, and add `sharedFolders={sharedFolders}` and `sharedNotes={sharedNotes}`:

```tsx
        <Sidebar
          folders={ownFolders}
          notes={ownNotes}
          sharedFolders={sharedFolders}
          sharedNotes={sharedNotes}
          ...
        />
```

(Keep every other `<Sidebar>` prop exactly as it is.)

- [ ] **Step 3: Mark a share seen when its resource is opened**

Still in `NotesShell.tsx`, add a helper and call it from the folder-select and note-open handlers.

Add this helper in the component body (near the other `useCallback`s):

```ts
  const markShareSeen = useCallback(
    (share: { shareId: string; seenAt: string | null } | undefined) => {
      if (share === undefined || share.seenAt !== null) return;
      void sharesApi.markSeen(share.shareId).catch(() => {
        // a failed mark-seen self-heals: the next fetch still reports it unseen
      });
      const seenAt = new Date().toISOString();
      setFolders((prev) =>
        prev.map((f) =>
          f.sharedWithMe?.shareId === share.shareId
            ? { ...f, sharedWithMe: { ...f.sharedWithMe, seenAt } }
            : f,
        ),
      );
      setNotes((prev) =>
        prev.map((n) =>
          n.sharedWithMe?.shareId === share.shareId
            ? { ...n, sharedWithMe: { ...n.sharedWithMe, seenAt } }
            : n,
        ),
      );
    },
    [],
  );
```

In the folder-selection handler (the function passed to `<Sidebar onSelectFolder=…>`; read the file for its real name, e.g. `selectFolder`), after the existing selection logic, look the folder up and mark it:

```ts
    markShareSeen(folders.find((f) => f.id === id)?.sharedWithMe);
```

Add `folders` and `markShareSeen` to that handler's `useCallback` dependency array.

In the note-open handler (`openNote`), after the existing logic, do the same with `notes`:

```ts
    markShareSeen(notes.find((n) => n.id === id)?.sharedWithMe);
```

Add `notes` and `markShareSeen` to `openNote`'s dependency array.

(If `selectFolder` / `openNote` are not `useCallback`s, or are named differently, adapt — the requirement is: when the user opens a shared folder or note, `markShareSeen` runs with that resource's `sharedWithMe`.)

- [ ] **Step 4: Verify typecheck and the notes test suite**

Run: `bun run typecheck`
Expected: all 8 packages exit 0. `sharedFolders`/`sharedNotes` are optional on `Sidebar`, so existing `Sidebar`/`NotesShell` test fixtures still typecheck.
Run: `bun run vitest run apps/web/src/components/notes`
Expected: PASS — existing component tests stay green (test fixtures have no `sharedWithMe`, so everything partitions to "own" and behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/index.tsx \
        apps/web/src/components/notes/NotesShell.tsx
git commit -m "feat(notes): surface shared resources in the sidebar"
```

---

## Task 8: Coverage wiring + full verification

**Files:** `vitest.config.ts`

- [ ] **Step 1: Add the new files to coverage `include`**

In `vitest.config.ts`, the `coverage.include` array lists files explicitly. Confirm whether each new file is already covered by an existing glob:
- `apps/web/src/lib/notes/shared-folders.ts` and `apps/web/src/lib/notes/access.ts` — covered by the existing `apps/web/src/lib/notes/**/*.ts` glob (no change needed).
- `apps/web/src/app/api/shares/[id]/seen/route.ts` — the `apps/web/src/app/api/notes/**/route.ts` glob does NOT match `api/shares/`. Add an entry: `'apps/web/src/app/api/shares/**/route.ts'`.
- `apps/web/src/components/notes/Sidebar/SharedWithMe.tsx` — the Sidebar components are listed by explicit path (e.g. `'apps/web/src/components/notes/Sidebar/FolderTree.tsx'`). Add: `'apps/web/src/components/notes/Sidebar/SharedWithMe.tsx'`.

Add the two missing entries alongside the existing ones.

- [ ] **Step 2: Full test suite**

Run: `bun run vitest run`
Expected: every test file passes.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 4: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. Catches Turbopack-only compile errors `vitest`/`tsc` miss.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for shared-resource discovery"
```

---

## Self-Review

**Spec coverage:**
- Dedicated "Shared with me" section → Task 6 (`SharedWithMe`) + Task 7 (rendered in `Sidebar`).
- Attribution + access badge → Task 6 (`Attribution`), fed by `sharedWithMe.sharedByName` / `.access` from Task 3.
- Unseen indicator (count + per-item dots) → Task 6 (`UnseenDot`, heading count) backed by `Share.seenAt` (Task 1) surfaced as `sharedWithMe.seenAt` (Task 3).
- Mark-seen on open → Task 4 (endpoint + `sharesApi.markSeen`) + Task 7 (`markShareSeen`).
- Orphaned-root bug fix → Task 5 (`partitionSharedFolders`) + Task 7 (`Sidebar` gets `ownFolders` only).
- `sharedWithMe` tagging on the list endpoints → Task 3.
- `listAccessibleScope` direct-share metadata → Task 2.
- i18n `notes.sharedWithMe` → Task 6.
- No ADR — consistent with the spec (ADR 0026 covers sharing).
- Turbopack build verification → Task 8.

**Placeholder scan:** No "TBD"/"implement later". The `<timestamp>` in the migration path is generated by Prisma. Tasks 1–7 give complete code; Task 7 gives the exact diffs and notes that handler names must be matched against the real file (a concrete instruction, not a placeholder).

**Type consistency:** `DirectShare` (`access.ts`, Task 2) has `seenAt: Date | null`; `SharedWithMe` (`schemas.ts`, Task 3) has `seenAt: string | null`; the `toSharedWithMe` helper (Task 3) converts `Date → ISO`. `directShares: Map<string, DirectShare>` is defined in Task 2 and consumed by `toNode`/`toListItem` in Task 3. `sharedWithMe?: SharedWithMe` on `FolderNode`/`NoteListItem` (Task 3) is read by `partitionSharedFolders` (Task 5), `SharedWithMe` (Task 6), and `markShareSeen` (Task 7). `sharesApi.markSeen(shareId)` is defined in Task 4 and called in Task 7. The `SharedWithMe` component prop names (`sharedFolders`, `sharedNotes`, `selectedFolderId`, `selectedNoteId`, `onSelectFolder`, `onSelectNote`) are identical in Task 6's definition, Task 6's tests, and Task 7's `Sidebar` render site.
