# Explicit Resource Sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make notes and folders private by default, shareable with named users at view/edit access (optionally time-limited), with every API path enforcing the resolved permission.

**Architecture:** A single `Share` table (two nullable FKs, DB XOR-check) plus a new `Folder.ownerId`. One resolution engine (`apps/web/src/lib/notes/access.ts`) computes effective access by walking the folder tree; every route handler calls it. Folder ownership and folder shares cascade downward. Share-management and user-search REST endpoints back a `ShareDialog` UI. The y-websocket token carries an access level so view-only users get a read-only collab session.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (`prisma-client`, `runtime=bun`), PostgreSQL 16, Zod, Vitest (integration tests hit a real Postgres), Bun, BullMQ worker, next-intl, TailwindCSS 4 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-05-16-resource-sharing-design.md`

**Conventions:** TDD (test first, watch it fail, minimal implementation, watch it pass, commit). Conventional Commits. lefthook pre-commit must pass — never `--no-verify`. Run tests with `bun run vitest run <path>` (never `bun test`). No `any` without a `// reason:` comment. Zod-validate every external boundary.

**Coupling note:** Tasks 14 + 19 + 20 are the "collab triple" — they change the y-websocket token format on both the web (issuer) and worker (verifier) sides. Collab is inconsistent between Task 14 and Task 19; run them consecutively and rebuild both apps before manual collab testing.

---

## Task 1: Schema — `Folder.ownerId`, `Share` model, migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<generated>/migration.sql`
- Modify: `apps/web/src/app/api/folders/route.ts` (POST sets `ownerId`)
- Modify (green-keeping — all `prisma.folder.create` call sites): `packages/db/prisma/seed.ts`, `packages/db/src/notes-schema.test.ts`, `apps/web/src/app/api/notes/[id]/route.test.ts`, `apps/web/src/app/api/notes/route.test.ts`, `apps/web/src/app/api/folders/route.test.ts`, `apps/web/src/app/api/folders/[id]/route.test.ts`, `apps/web/src/app/api/folders/reorder/route.test.ts`

- [ ] **Step 1: Edit the Prisma schema**

In `packages/db/prisma/schema.prisma`, add to the `Folder` model:
```prisma
  ownerId   String
  owner     User     @relation("folder_owner", fields: [ownerId], references: [id], onDelete: Restrict)
  shares    Share[]
```
and add `@@index([ownerId])` alongside the existing `Folder` indexes.

Add to the `Note` model:
```prisma
  shares       Share[]
```

Add to the `User` model:
```prisma
  ownedFolders   Folder[]      @relation("folder_owner")
  sharesReceived Share[]       @relation("share_grantee")
  sharesCreated  Share[]       @relation("share_creator")
```

Add the new enum and model at the end of the file:
```prisma
/// View or edit access level for a Share.
enum ShareAccess {
  VIEW
  EDIT
}

/// An explicit grant of access to a single Note OR a single Folder.
/// Exactly one of noteId / folderId is set — enforced by a DB CHECK
/// constraint added in the migration's raw-SQL block.
model Share {
  id          String      @id @default(cuid())
  noteId      String?
  note        Note?       @relation(fields: [noteId], references: [id], onDelete: Cascade)
  folderId    String?
  folder      Folder?     @relation(fields: [folderId], references: [id], onDelete: Cascade)
  granteeId   String
  grantee     User        @relation("share_grantee", fields: [granteeId], references: [id], onDelete: Cascade)
  access      ShareAccess
  expiresAt   DateTime?
  createdById String
  createdBy   User        @relation("share_creator", fields: [createdById], references: [id], onDelete: Cascade)
  createdAt   DateTime    @default(now())

  @@unique([noteId, granteeId])
  @@unique([folderId, granteeId])
  @@index([granteeId])
  @@index([noteId])
  @@index([folderId])
  @@index([expiresAt])
}
```

Also correct the now-false comment on the `Tag` model — replace
`/// sharing model in v1 is "all users see all notes".` with
`/// global because tags are a shared vocabulary; note/folder access is`
`/// governed per-resource by the Share model (see ADR 0026).`

- [ ] **Step 2: Generate the migration (create-only)**

Ensure `DATABASE_URL` is exported (it lives in `.env.local`).
Run: `cd packages/db && bunx --bun prisma migrate dev --name add_resource_sharing --create-only`
Expected: a new folder `packages/db/prisma/migrations/<timestamp>_add_resource_sharing/migration.sql` is created, not yet applied.

- [ ] **Step 3: Replace the generated `migration.sql`**

Overwrite the generated `migration.sql` with exactly this (the generator emits a non-applicable `ADD COLUMN "ownerId" TEXT NOT NULL` — this version adds it nullable, backfills, then enforces):
```sql
-- CreateEnum
CREATE TYPE "ShareAccess" AS ENUM ('VIEW', 'EDIT');

-- AlterTable: Folder.ownerId — add nullable, backfill, then enforce NOT NULL
ALTER TABLE "Folder" ADD COLUMN "ownerId" TEXT;

UPDATE "Folder" f SET "ownerId" = (
  SELECT n."authorId" FROM "Note" n
   WHERE n."folderId" = f."id"
   ORDER BY n."updatedAt" DESC
   LIMIT 1
);

UPDATE "Folder" SET "ownerId" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1
) WHERE "ownerId" IS NULL;

ALTER TABLE "Folder" ALTER COLUMN "ownerId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "noteId" TEXT,
    "folderId" TEXT,
    "granteeId" TEXT NOT NULL,
    "access" "ShareAccess" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_ownerId_idx" ON "Folder"("ownerId");
CREATE INDEX "Share_granteeId_idx" ON "Share"("granteeId");
CREATE INDEX "Share_noteId_idx" ON "Share"("noteId");
CREATE INDEX "Share_folderId_idx" ON "Share"("folderId");
CREATE INDEX "Share_expiresAt_idx" ON "Share"("expiresAt");
CREATE UNIQUE INDEX "Share_noteId_granteeId_key" ON "Share"("noteId", "granteeId");
CREATE UNIQUE INDEX "Share_folderId_granteeId_key" ON "Share"("folderId", "granteeId");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- XOR check: exactly one of noteId / folderId is set
ALTER TABLE "Share" ADD CONSTRAINT "Share_exactly_one_target" CHECK (("noteId" IS NOT NULL) <> ("folderId" IS NOT NULL));
```

- [ ] **Step 4: Apply the migration and regenerate the client**

Run: `cd packages/db && bunx --bun prisma migrate dev && bunx --bun prisma generate`
Expected: migration applies cleanly; Prisma client regenerates with `Share`, `ShareAccess`, and `Folder.ownerId`.

- [ ] **Step 5: Green-keep — `folders` POST sets `ownerId`**

In `apps/web/src/app/api/folders/route.ts`, the `POST` handler `prisma.folder.create` `data` block — add `ownerId: user.id`:
```ts
  const created = await prisma.folder.create({
    data: {
      name,
      ownerId: user.id,
      ...(parentId === undefined || parentId === null ? {} : { parentId }),
      ...(position === undefined ? {} : { position }),
    },
```

- [ ] **Step 6: Green-keep — every `prisma.folder.create` call site**

Run: `grep -rn "folder.create" packages/db apps/web/src --include='*.ts'`
For each call site in `seed.ts`, `notes-schema.test.ts`, and the four route test files, add `ownerId: <an existing user id>` to the `data` block. In the test files each test already has a `user` from `makeTestUser()` — use `ownerId: user.id`. In `seed.ts` use the seeded user's id. In `notes-schema.test.ts` create or reuse a `User` row and pass its id.

- [ ] **Step 7: Verify the suite compiles and passes**

Run: `bun run vitest run packages/db apps/web/src/app/api/folders`
Expected: PASS — no `ownerId`-missing errors.
Run: `bun run typecheck` (from repo root) — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db apps/web/src/app/api/folders/route.ts apps/web/src/app/api/notes apps/web/src/app/api/folders
git commit -m "feat(db): Share model + Folder.ownerId for resource sharing"
```

---

## Task 2: Test fixtures for folders, notes, shares

**Files:**
- Modify: `apps/web/src/lib/api/test-session.ts`

- [ ] **Step 1: Add the fixture helpers**

Append to `apps/web/src/lib/api/test-session.ts`:
```ts
export const makeTestFolder = async (opts: {
  ownerId: string;
  parentId?: string;
  name?: string;
}): Promise<{ id: string }> =>
  prisma.folder.create({
    data: {
      name: opts.name ?? `${TEST_PREFIX}folder-${randSuffix()}`,
      ownerId: opts.ownerId,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
    },
    select: { id: true },
  });

export const makeTestNote = async (opts: {
  authorId: string;
  folderId?: string;
  title?: string;
  body?: string;
}): Promise<{ id: string }> =>
  prisma.note.create({
    data: {
      title: opts.title ?? `${TEST_PREFIX}note-${randSuffix()}`,
      body: opts.body ?? '',
      authorId: opts.authorId,
      ...(opts.folderId ? { folderId: opts.folderId } : {}),
    },
    select: { id: true },
  });

export const makeTestShare = async (opts: {
  noteId?: string;
  folderId?: string;
  granteeId: string;
  createdById: string;
  access: 'VIEW' | 'EDIT';
  expiresAt?: Date | null;
}): Promise<{ id: string }> =>
  prisma.share.create({
    data: {
      ...(opts.noteId ? { noteId: opts.noteId } : {}),
      ...(opts.folderId ? { folderId: opts.folderId } : {}),
      granteeId: opts.granteeId,
      createdById: opts.createdById,
      access: opts.access,
      expiresAt: opts.expiresAt ?? null,
    },
    select: { id: true },
  });
```

- [ ] **Step 2: Clear `Share` rows in `cleanupNotesDomain`**

In the same file, add as the **first** statement inside `cleanupNotesDomain`:
```ts
  await prisma.share.deleteMany({
    where: {
      OR: [
        { grantee: { email: { startsWith: TEST_PREFIX } } },
        { createdBy: { email: { startsWith: TEST_PREFIX } } },
        { note: { author: { email: { startsWith: TEST_PREFIX } } } },
        { folder: { name: { startsWith: TEST_PREFIX } } },
      ],
    },
  });
```

- [ ] **Step 3: Verify it compiles**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api/test-session.ts
git commit -m "test(notes): folder/note/share fixtures + share cleanup"
```

---

## Task 3: Access engine — types and rank helpers

**Files:**
- Create: `apps/web/src/lib/notes/access.ts`
- Create: `apps/web/src/lib/notes/access.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/access.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { atLeast, canEdit, canHardDelete, canManageShares } from './access.ts';

describe('access rank helpers', () => {
  it('atLeast compares the rank ladder', () => {
    expect(atLeast('OWNER', 'VIEW')).toBe(true);
    expect(atLeast('EDIT', 'EDIT')).toBe(true);
    expect(atLeast('VIEW', 'EDIT')).toBe(false);
    expect(atLeast(null, 'VIEW')).toBe(false);
  });

  it('canEdit / canManageShares need EDIT or higher', () => {
    expect(canEdit('EDIT')).toBe(true);
    expect(canEdit('VIEW')).toBe(false);
    expect(canManageShares('OWNER')).toBe(true);
    expect(canManageShares('VIEW')).toBe(false);
    expect(canManageShares(null)).toBe(false);
  });

  it('canHardDelete needs OWNER', () => {
    expect(canHardDelete('OWNER')).toBe(true);
    expect(canHardDelete('EDIT')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: FAIL — cannot find module `./access.ts`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/notes/access.ts`:
```ts
import { prisma } from '@app/db';

/**
 * Permission-resolution engine — the single source of authorization truth
 * for notes and folders. See docs/adr/0026-explicit-resource-sharing.md.
 */

export type Access = 'OWNER' | 'EDIT' | 'VIEW';

const RANK: Record<Access, number> = { VIEW: 1, EDIT: 2, OWNER: 3 };

/** True when `access` is at least `min` on the OWNER > EDIT > VIEW ladder. */
export const atLeast = (access: Access | null, min: Access): boolean =>
  access !== null && RANK[access] >= RANK[min];

export const canEdit = (access: Access | null): boolean => atLeast(access, 'EDIT');
export const canManageShares = (access: Access | null): boolean => atLeast(access, 'EDIT');
export const canHardDelete = (access: Access | null): boolean => atLeast(access, 'OWNER');

const bestAccess = (accesses: ReadonlyArray<Access>): Access | null => {
  if (accesses.length === 0) return null;
  return accesses.reduce((best, a) => (RANK[a] > RANK[best] ? a : best));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/access.ts apps/web/src/lib/notes/access.test.ts
git commit -m "feat(notes): access rank helpers"
```

---

## Task 4: Access engine — `folderChain`

**Files:**
- Modify: `apps/web/src/lib/notes/access.ts`
- Modify: `apps/web/src/lib/notes/access.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `access.test.ts` (and add the imports `afterAll, beforeEach` from vitest, `prisma` from `@app/db`, `cleanupNotesDomain, makeTestFolder, makeTestUser` from `@/lib/api/test-session.ts`, and `folderChain` to the `./access.ts` import):
```ts
describe('folderChain', () => {
  beforeEach(async () => {
    await cleanupNotesDomain();
  });
  afterAll(async () => {
    await cleanupNotesDomain();
    await prisma.$disconnect();
  });

  it('returns the folder and all ancestors, nearest-first', async () => {
    const { user } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: user.id });
    const mid = await makeTestFolder({ ownerId: user.id, parentId: root.id });
    const leaf = await makeTestFolder({ ownerId: user.id, parentId: mid.id });

    const chain = await folderChain(leaf.id);
    expect(chain.map((f) => f.id)).toEqual([leaf.id, mid.id, root.id]);
  });

  it('returns [] for a null folderId and for a missing id', async () => {
    expect(await folderChain(null)).toEqual([]);
    expect(await folderChain('does-not-exist')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: FAIL — `folderChain` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `access.ts`:
```ts
const MAX_FOLDER_DEPTH = 64;

export type FolderLink = { id: string; ownerId: string };

/**
 * The folder and every ancestor, nearest-first. Cycle-safe (a `visited`
 * set + depth cap) so a corrupt parent chain cannot loop forever. Returns
 * `[]` for a null id or a missing folder.
 */
export const folderChain = async (folderId: string | null): Promise<FolderLink[]> => {
  const chain: FolderLink[] = [];
  const visited = new Set<string>();
  let current = folderId;
  while (current !== null && !visited.has(current) && chain.length < MAX_FOLDER_DEPTH) {
    visited.add(current);
    const folder = await prisma.folder.findUnique({
      where: { id: current },
      select: { id: true, ownerId: true, parentId: true },
    });
    if (!folder) break;
    chain.push({ id: folder.id, ownerId: folder.ownerId });
    current = folder.parentId;
  }
  return chain;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/access.ts apps/web/src/lib/notes/access.test.ts
git commit -m "feat(notes): folderChain ancestor walk"
```

---

## Task 5: Access engine — `resolveNoteAccess`

**Files:**
- Modify: `apps/web/src/lib/notes/access.ts`
- Modify: `apps/web/src/lib/notes/access.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `access.test.ts` (add `makeTestNote, makeTestShare` to the test-session import, `resolveNoteAccess` to the access import):
```ts
describe('resolveNoteAccess', () => {
  it('returns null for a missing note', async () => {
    const { user } = await makeTestUser();
    expect(await resolveNoteAccess(user.id, 'missing')).toBeNull();
  });

  it('OWNER for the author', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    expect(await resolveNoteAccess(user.id, note.id)).toBe('OWNER');
  });

  it('null for an unrelated user', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    expect(await resolveNoteAccess(b.id, note.id)).toBeNull();
  });

  it('reflects a direct note share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    await makeTestShare({ noteId: note.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    expect(await resolveNoteAccess(b.id, note.id)).toBe('VIEW');
  });

  it('inherits an ancestor folder share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: a.id, parentId: root.id });
    const note = await makeTestNote({ authorId: a.id, folderId: sub.id });
    await makeTestShare({ folderId: root.id, granteeId: b.id, createdById: a.id, access: 'EDIT' });
    expect(await resolveNoteAccess(b.id, note.id)).toBe('EDIT');
  });

  it('OWNER when the user owns an ancestor folder', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: a.id });
    const note = await makeTestNote({ authorId: b.id, folderId: folder.id });
    expect(await resolveNoteAccess(a.id, note.id)).toBe('OWNER');
  });

  it('ignores an expired share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    await makeTestShare({
      noteId: note.id, granteeId: b.id, createdById: a.id, access: 'EDIT',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await resolveNoteAccess(b.id, note.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: FAIL — `resolveNoteAccess` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `access.ts`:
```ts
/** Prisma `where` fragment matching shares that have not expired. */
const activeShareWhere = (now: Date) => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

/**
 * Effective access for `userId` on a note: OWNER if author or an ancestor
 * folder owner, else the best active Share on the note or any ancestor
 * folder, else null. Returns null for a missing note.
 */
export const resolveNoteAccess = async (
  userId: string,
  noteId: string,
): Promise<Access | null> => {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { authorId: true, folderId: true },
  });
  if (!note) return null;
  if (note.authorId === userId) return 'OWNER';

  const chain = await folderChain(note.folderId);
  if (chain.some((f) => f.ownerId === userId)) return 'OWNER';

  const grants = await prisma.share.findMany({
    where: {
      granteeId: userId,
      AND: [
        activeShareWhere(new Date()),
        { OR: [{ noteId }, { folderId: { in: chain.map((f) => f.id) } }] },
      ],
    },
    select: { access: true },
  });
  return bestAccess(grants.map((g) => g.access));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/access.ts apps/web/src/lib/notes/access.test.ts
git commit -m "feat(notes): resolveNoteAccess"
```

---

## Task 6: Access engine — `resolveFolderAccess`

**Files:**
- Modify: `apps/web/src/lib/notes/access.ts`
- Modify: `apps/web/src/lib/notes/access.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `access.test.ts` (add `resolveFolderAccess` to the access import):
```ts
describe('resolveFolderAccess', () => {
  it('returns null for a missing folder', async () => {
    const { user } = await makeTestUser();
    expect(await resolveFolderAccess(user.id, 'missing')).toBeNull();
  });

  it('OWNER for the folder owner', async () => {
    const { user } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: user.id });
    expect(await resolveFolderAccess(user.id, folder.id)).toBe('OWNER');
  });

  it('OWNER when the user owns an ancestor folder', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: b.id, parentId: root.id });
    expect(await resolveFolderAccess(a.id, sub.id)).toBe('OWNER');
  });

  it('reflects a direct or inherited folder share', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: a.id, parentId: root.id });
    await makeTestShare({ folderId: root.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    expect(await resolveFolderAccess(b.id, sub.id)).toBe('VIEW');
  });

  it('null for an unrelated user', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: a.id });
    expect(await resolveFolderAccess(b.id, folder.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: FAIL — `resolveFolderAccess` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `access.ts`:
```ts
/**
 * Effective access for `userId` on a folder: OWNER if the user owns the
 * folder or any ancestor, else the best active Share on the folder or any
 * ancestor, else null. Returns null for a missing folder.
 */
export const resolveFolderAccess = async (
  userId: string,
  folderId: string,
): Promise<Access | null> => {
  const chain = await folderChain(folderId);
  if (chain.length === 0) return null;
  if (chain.some((f) => f.ownerId === userId)) return 'OWNER';

  const grants = await prisma.share.findMany({
    where: {
      granteeId: userId,
      AND: [activeShareWhere(new Date()), { folderId: { in: chain.map((f) => f.id) } }],
    },
    select: { access: true },
  });
  return bestAccess(grants.map((g) => g.access));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/access.ts apps/web/src/lib/notes/access.test.ts
git commit -m "feat(notes): resolveFolderAccess"
```

---

## Task 7: Access engine — `listAccessibleScope`

**Files:**
- Modify: `apps/web/src/lib/notes/access.ts`
- Modify: `apps/web/src/lib/notes/access.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `access.test.ts` (add `listAccessibleScope` to the access import):
```ts
describe('listAccessibleScope', () => {
  it('includes owned folders and their descendants', async () => {
    const { user } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: user.id });
    const sub = await makeTestFolder({ ownerId: user.id, parentId: root.id });
    const scope = await listAccessibleScope(user.id);
    expect(scope.accessibleFolderIds).toEqual(expect.arrayContaining([root.id, sub.id]));
  });

  it('includes shared folders, their descendants, and shared notes', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const root = await makeTestFolder({ ownerId: a.id });
    const sub = await makeTestFolder({ ownerId: a.id, parentId: root.id });
    const note = await makeTestNote({ authorId: a.id });
    await makeTestShare({ folderId: root.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    await makeTestShare({ noteId: note.id, granteeId: b.id, createdById: a.id, access: 'VIEW' });
    const scope = await listAccessibleScope(b.id);
    expect(scope.accessibleFolderIds).toEqual(expect.arrayContaining([root.id, sub.id]));
    expect(scope.sharedNoteIds).toContain(note.id);
  });

  it('excludes a folder shared only via an expired grant', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await makeTestFolder({ ownerId: a.id });
    await makeTestShare({
      folderId: folder.id, granteeId: b.id, createdById: a.id, access: 'VIEW',
      expiresAt: new Date(Date.now() - 1000),
    });
    const scope = await listAccessibleScope(b.id);
    expect(scope.accessibleFolderIds).not.toContain(folder.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: FAIL — `listAccessibleScope` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `access.ts`:
```ts
export type AccessibleScope = {
  /** Folder ids the user owns or has a share on, plus all descendants. */
  accessibleFolderIds: string[];
  /** Note ids shared directly with the user. */
  sharedNoteIds: string[];
};

/**
 * The set of folders/notes a user may see, for filtering list & search.
 * Loads the (small) folder table once and expands the tree in memory.
 */
export const listAccessibleScope = async (userId: string): Promise<AccessibleScope> => {
  const now = new Date();
  const [folders, folderShares, noteShares] = await Promise.all([
    prisma.folder.findMany({ select: { id: true, parentId: true, ownerId: true } }),
    prisma.share.findMany({
      where: { granteeId: userId, folderId: { not: null }, AND: [activeShareWhere(now)] },
      select: { folderId: true },
    }),
    prisma.share.findMany({
      where: { granteeId: userId, noteId: { not: null }, AND: [activeShareWhere(now)] },
      select: { noteId: true },
    }),
  ]);

  const childrenOf = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === null) continue;
    const arr = childrenOf.get(f.parentId) ?? [];
    arr.push(f.id);
    childrenOf.set(f.parentId, arr);
  }

  const roots = new Set<string>();
  for (const f of folders) if (f.ownerId === userId) roots.add(f.id);
  for (const s of folderShares) if (s.folderId !== null) roots.add(s.folderId);

  const accessible = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (accessible.has(id)) continue;
    accessible.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }

  return {
    accessibleFolderIds: [...accessible],
    sharedNoteIds: noteShares
      .map((s) => s.noteId)
      .filter((id): id is string => id !== null),
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `access.ts` to the coverage allow-list, then commit**

In `vitest.config.ts`, add `'apps/web/src/lib/notes/access.ts'` to the coverage `include` array (match the existing entry style). Run `bun run vitest run apps/web/src/lib/notes/access.test.ts` once more to confirm it still passes, then:
```bash
git add apps/web/src/lib/notes/access.ts apps/web/src/lib/notes/access.test.ts vitest.config.ts
git commit -m "feat(notes): listAccessibleScope + coverage wiring"
```

---

## Task 8: Enforce access on `notes/[id]` (GET / PATCH / DELETE)

**Files:**
- Modify: `apps/web/src/app/api/notes/[id]/route.ts`
- Modify: `apps/web/src/app/api/notes/[id]/route.test.ts`

- [ ] **Step 1: Write the failing tests**

In `route.test.ts`, add `makeTestNote` to the `test-session` import, then append a describe block:
```ts
describe('GET/PATCH/DELETE /api/notes/[id] — cross-user authorization', () => {
  it('403s GET of another user’s private note', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    setAuthed(b);
    const res = await GET(new Request(`http://localhost/api/notes/${note.id}`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(403);
  });

  it('allows GET with a VIEW share but 403s PATCH', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    await prisma.share.create({
      data: { noteId: note.id, granteeId: b.id, createdById: a.id, access: 'VIEW' },
    });
    setAuthed(b);
    const get = await GET(new Request(`http://localhost/api/notes/${note.id}`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(get.status).toBe(200);
    const patch = await PATCH(
      new Request(`http://localhost/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'nope' }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    expect(patch.status).toBe(403);
  });

  it('403s a hard delete by an EDIT-grantee, allows archive', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const note = await makeTestNote({ authorId: a.id });
    await prisma.share.create({
      data: { noteId: note.id, granteeId: b.id, createdById: a.id, access: 'EDIT' },
    });
    setAuthed(b);
    const hard = await DELETE(new Request(`http://localhost/api/notes/${note.id}?hard=1`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(hard.status).toBe(403);
    const archive = await DELETE(new Request(`http://localhost/api/notes/${note.id}`), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(archive.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/notes/[id]/route.test.ts`
Expected: FAIL — cross-user requests currently return 200.

- [ ] **Step 3: Add the guards**

In `apps/web/src/app/api/notes/[id]/route.ts`, add the import:
```ts
import { canEdit, canHardDelete, resolveNoteAccess } from '@/lib/notes/access.ts';
```
In `GET`, after the `if (!note) return jsonError(404, 'not found');` line:
```ts
  const access = await resolveNoteAccess(user.id, id);
  if (access === null) return jsonError(403, 'forbidden');
```
In `PATCH`, after `if (!existing) return jsonError(404, 'not found');`:
```ts
  const access = await resolveNoteAccess(user.id, id);
  if (!canEdit(access)) return jsonError(403, 'forbidden');
  if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
    const { resolveFolderAccess } = await import('@/lib/notes/access.ts');
    const folderAccess = await resolveFolderAccess(user.id, parsed.data.folderId);
    if (!canEdit(folderAccess)) return jsonError(403, 'forbidden: target folder');
  }
```
(Replace the dynamic `import` with a top-level `resolveFolderAccess` import in the same import statement — written inline here only to keep the diff local; prefer the static import.)
In `DELETE`, after `if (!existing) return jsonError(404, 'not found');`:
```ts
  const access = await resolveNoteAccess(user.id, id);
  if (hard ? !canHardDelete(access) : !canEdit(access)) return jsonError(403, 'forbidden');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/notes/[id]/route.test.ts`
Expected: PASS — including all pre-existing tests (the author still resolves to OWNER).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/notes/[id]/route.ts apps/web/src/app/api/notes/[id]/route.test.ts
git commit -m "feat(notes): enforce per-note access on GET/PATCH/DELETE"
```

---

## Task 9: Enforce access on `notes/[id]/body`, `/history`, `/assets`

**Files:**
- Modify: `apps/web/src/app/api/notes/[id]/body/route.ts` + its `route.test.ts`
- Modify: `apps/web/src/app/api/notes/[id]/history/route.ts` + its `route.test.ts`
- Modify: `apps/web/src/app/api/notes/[id]/assets/route.ts` + its `route.test.ts`

- [ ] **Step 1: Write the failing tests**

In each of the three `route.test.ts` files, add a cross-user denial test. For `body/route.test.ts` (gate: `EDIT`):
```ts
it('403s PUT body for a non-editor', async () => {
  const { user: a } = await makeTestUser();
  const { user: b } = await makeTestUser();
  const note = await makeTestNote({ authorId: a.id });
  setAuthed(b);
  const res = await PUT(
    new Request(`http://localhost/api/notes/${note.id}/body`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x', baseUpdatedAt: new Date().toISOString() }),
    }),
    { params: Promise.resolve({ id: note.id }) },
  );
  expect(res.status).toBe(403);
});
```
For `history/route.test.ts` (gate: `VIEW`) — same shape, `GET`, expect 403.
For `assets/route.test.ts` (gate: `EDIT` on the note) — `POST` an upload as user B, expect 403.
(Use the file's existing imports/helpers; add `makeTestNote` to the `test-session` import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/notes/[id]/body apps/web/src/app/api/notes/[id]/history apps/web/src/app/api/notes/[id]/assets`
Expected: FAIL — cross-user requests not yet blocked.

- [ ] **Step 3: Add the guards**

In `body/route.ts` — import `{ canEdit, resolveNoteAccess }` from `@/lib/notes/access.ts`; inside the `withSpan` callback, immediately after the `if (!existing) return jsonError(404, 'not found');` line:
```ts
      const access = await resolveNoteAccess(user.id, id);
      if (!canEdit(access)) return jsonError(403, 'forbidden');
```
In `history/route.ts` — import `{ resolveNoteAccess }`; after `if (!note) return jsonError(404, 'not found');`:
```ts
  const access = await resolveNoteAccess(user.id, id);
  if (access === null) return jsonError(403, 'forbidden');
```
In `assets/route.ts` — import `{ canEdit, resolveNoteAccess }`; after `if (!note) return jsonError(404, 'note not found');`:
```ts
  const access = await resolveNoteAccess(user.id, noteId);
  if (!canEdit(access)) return jsonError(403, 'forbidden');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/notes/[id]/body apps/web/src/app/api/notes/[id]/history apps/web/src/app/api/notes/[id]/assets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/notes/[id]/body apps/web/src/app/api/notes/[id]/history apps/web/src/app/api/notes/[id]/assets
git commit -m "feat(notes): enforce access on body/history/assets routes"
```

---

## Task 10: Enforce access on `notes` list + POST, add `shareCount`

**Files:**
- Modify: `apps/web/src/app/api/notes/route.ts`
- Modify: `apps/web/src/lib/api/schemas.ts` (`NoteListItem` gains `shareCount`)
- Modify: `apps/web/src/app/api/notes/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `notes/route.test.ts` (add `makeTestNote` to the import):
```ts
describe('GET/POST /api/notes — authorization', () => {
  it('list excludes another user’s private notes', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    await makeTestNote({ authorId: a.id, title: 'api-test-private-a' });
    const mine = await makeTestNote({ authorId: b.id, title: 'api-test-mine-b' });
    setAuthed(b);
    const res = await GET(new Request('http://localhost/api/notes'));
    const body = (await res.json()) as { notes: Array<{ id: string }> };
    const ids = body.notes.map((n) => n.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain((await prisma.note.findFirst({ where: { title: 'api-test-private-a' } }))?.id);
  });

  it('403s POST into a folder the user cannot edit', async () => {
    const { user: a } = await makeTestUser();
    const { user: b } = await makeTestUser();
    const folder = await prisma.folder.create({
      data: { name: 'api-test-foreign-folder', ownerId: a.id },
    });
    setAuthed(b);
    const res = await POST(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x', folderId: folder.id }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/notes/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the list filter, POST guard, and `shareCount`**

In `apps/web/src/lib/api/schemas.ts`, add `shareCount: number` to the `NoteListItem` type.

In `apps/web/src/app/api/notes/route.ts`:
- Import `{ canEdit, listAccessibleScope, resolveFolderAccess } from '@/lib/notes/access.ts'`.
- In `toListItem`, accept and pass through a `_count` field: change the param type to include `_count: { shares: number }` and set `shareCount: n._count.shares` in the returned object.
- In `GET`, before `withSpan`, compute `const scope = await listAccessibleScope(user.id);`. Wrap the existing `where` object inside an `AND` with the access predicate:
```ts
        where: {
          AND: [
            {
              OR: [
                { authorId: user.id },
                { folderId: { in: scope.accessibleFolderIds } },
                { id: { in: scope.sharedNoteIds } },
              ],
            },
            {
              ...(folderId === undefined ? {} : { folderId }),
              ...(tagId === undefined ? {} : { tags: { some: { tagId } } }),
              ...(includeArchived === true ? {} : { archivedAt: null }),
              ...(q && q.trim().length > 0
                ? { OR: [{ title: { contains: q, mode: 'insensitive' } }] }
                : {}),
            },
          ],
        },
```
- In the `select` for the list query, add:
```ts
          _count: { select: { shares: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } } },
```
- In `POST`, after the body is parsed, if `folderId` is a non-null string:
```ts
  if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
    const folderAccess = await resolveFolderAccess(user.id, parsed.data.folderId);
    if (!canEdit(folderAccess)) return jsonError(403, 'forbidden: target folder');
  }
```
- In the `POST` `select`, add the same `_count` field and update its `toListItem` call (the created note has 0 shares).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/notes/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/notes/route.ts apps/web/src/lib/api/schemas.ts apps/web/src/app/api/notes/route.test.ts
git commit -m "feat(notes): filter note list by access + shareCount"
```

---

## Task 11: Enforce access on `assets/[id]` and `assets/[id]/preview`

**Files:**
- Modify: `apps/web/src/app/api/assets/[id]/route.ts` + `route.test.ts`
- Modify: `apps/web/src/app/api/assets/[id]/preview/route.ts` + `route.test.ts`

- [ ] **Step 1: Write the failing tests**

In `assets/[id]/route.test.ts`, add: a cross-user `GET` of an asset whose note belongs to user A → 403; a cross-user `PATCH` caption → 403. In `preview/route.test.ts`, add a cross-user `GET` → 403. Build the asset with `prisma.asset.create({ data: { noteId, authorId: a.id, kind: 'IMAGE', contentType: 'image/png', filename: 'x.png', byteSize: 3, data: Buffer.from([1,2,3]) } })` where `noteId` comes from `makeTestNote({ authorId: a.id })`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/assets`
Expected: FAIL.

- [ ] **Step 3: Add the guards**

In `assets/[id]/route.ts`:
- Import `{ canEdit, resolveNoteAccess } from '@/lib/notes/access.ts'`.
- In `GET`, change the `select` to include `noteId: true`. After `if (!asset) return jsonError(404, 'asset not found');`:
```ts
  const access = await resolveNoteAccess(user.id, asset.noteId);
  if (access === null) return jsonError(403, 'forbidden');
```
- In `PATCH`, change the existence-check `select` to `{ id: true, noteId: true }`. After `if (!existing) return jsonError(404, 'asset not found');`:
```ts
  const access = await resolveNoteAccess(user.id, existing.noteId);
  if (!canEdit(access)) return jsonError(403, 'forbidden');
```
In `assets/[id]/preview/route.ts`:
- Import `{ resolveNoteAccess }`.
- Change the `select` to include `noteId: true`. After the `if (!asset || asset.previewImage === null …)` 404 block:
```ts
  const access = await resolveNoteAccess(user.id, asset.noteId);
  if (access === null) return jsonError(403, 'forbidden');
```
(Resolve `noteId` before the preview-null check if needed — load `noteId` in the same `findUnique`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/assets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/assets
git commit -m "feat(notes): enforce note access on asset routes"
```

---

## Task 12: Enforce access on the folders routes

**Files:**
- Modify: `apps/web/src/app/api/folders/route.ts` + `route.test.ts`
- Modify: `apps/web/src/app/api/folders/[id]/route.ts` + `route.test.ts`
- Modify: `apps/web/src/app/api/folders/reorder/route.ts` + `route.test.ts`
- Modify: `apps/web/src/lib/api/schemas.ts` (`FolderNode` gains `shareCount`)

- [ ] **Step 1: Write the failing tests**

Add cross-user denial tests: `folders` list excludes another user's folders; `POST` a subfolder under a foreign folder → 403; `folders/[id]` `GET` foreign folder → 403, `PATCH` → 403, `DELETE` by a non-owner EDIT-grantee → 403; `folders/reorder` of a foreign folder → 403.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/folders`
Expected: FAIL.

- [ ] **Step 3: Implement the guards**

In `apps/web/src/lib/api/schemas.ts`, add `shareCount: number` to `FolderNode`.

`folders/route.ts`:
- Import `{ canEdit, listAccessibleScope, resolveFolderAccess }`.
- `GET`: `const scope = await listAccessibleScope(user.id);` then `where: { id: { in: scope.accessibleFolderIds } }`; add the filtered `_count` (same `OR` expiry filter as Task 10) to the `select`; have `toNode` set `shareCount` from `_count.shares`.
- `POST`: after parsing, if `parentId` is a non-null string:
```ts
  if (parentId) {
    const parentAccess = await resolveFolderAccess(user.id, parentId);
    if (!canEdit(parentAccess)) return jsonError(403, 'forbidden: parent folder');
  }
```
(This replaces the existing parent-existence check — `resolveFolderAccess` returns `null` for a missing folder, which yields a 403. If a 400-for-missing is preferred, keep the existence check and add the access check after it.) The `_count` field also needs adding to the `POST` `select`, set to 0 for the new folder.

`folders/[id]/route.ts`:
- Import `{ canEdit, canHardDelete, resolveFolderAccess }`.
- `GET`: after `if (!folder) return jsonError(404, 'not found');` → `const access = await resolveFolderAccess(user.id, id); if (access === null) return jsonError(403, 'forbidden');`. Add `_count` to the `select` and set `shareCount` in `toNode`.
- `PATCH`: after `if (!existing) …` → `const access = await resolveFolderAccess(user.id, id); if (!canEdit(access)) return jsonError(403, 'forbidden');`. If `parsed.data.parentId` is a non-null string, also `resolveFolderAccess` the target parent and require `canEdit`.
- `DELETE`: after `if (!existing) …` → `const access = await resolveFolderAccess(user.id, id); if (!canHardDelete(access)) return jsonError(403, 'forbidden');`.

`folders/reorder/route.ts`:
- Import `{ canEdit, resolveFolderAccess }`.
- Inside the `withSpan` callback, after the `unknown folder` / `unknown parent folder` checks, before the cycle guard:
```ts
      for (const id of orderedIds) {
        const access = await resolveFolderAccess(user.id, id);
        if (!canEdit(access)) return jsonError(403, 'forbidden', { id });
      }
      if (parentId !== null) {
        const parentAccess = await resolveFolderAccess(user.id, parentId);
        if (!canEdit(parentAccess)) return jsonError(403, 'forbidden: parent', { parentId });
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/folders`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/folders apps/web/src/lib/api/schemas.ts
git commit -m "feat(notes): enforce per-folder access on folders routes"
```

---

## Task 13: Filter `search` results by access

**Files:**
- Modify: `apps/web/src/app/api/search/route.ts`
- Modify: `apps/web/src/app/api/search/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `search/route.test.ts` (use the file's existing helpers; add `makeTestNote`):
```ts
it('does not return another user’s private note', async () => {
  const { user: a } = await makeTestUser();
  const { user: b } = await makeTestUser();
  await makeTestNote({ authorId: a.id, title: 'api-test-secret-pineapple' });
  setAuthed(b);
  const res = await GET(new Request('http://localhost/api/search?q=pineapple'));
  const body = (await res.json()) as { hits: Array<{ title: string }> };
  expect(body.hits.find((h) => h.title.includes('pineapple'))).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/app/api/search/route.test.ts`
Expected: FAIL — the private note is returned.

- [ ] **Step 3: Inject the access predicate**

In `apps/web/src/app/api/search/route.ts`:
- Import `{ listAccessibleScope } from '@/lib/notes/access.ts'`.
- Inside the `withSpan` callback, before building the queries: `const scope = await listAccessibleScope(user.id);`.
- Add this SQL fragment to the `WHERE` of all three raw queries (tsvector note query, asset-join query, trigram fallback), as positional params after the existing ones:
```sql
   AND (n."authorId" = $3 OR n."folderId" = ANY($4::text[]) OR n.id = ANY($5::text[]))
```
- Pass the three extra params to each `$queryRawUnsafe` call after the existing ones, in order: `user.id`, `scope.accessibleFolderIds`, `scope.sharedNoteIds`. The tsvector + asset queries currently pass `(tsquery, limit)` → now `(tsquery, limit, user.id, scope.accessibleFolderIds, scope.sharedNoteIds)`. The trigram fallback passes `(q, limit)` → now `(q, limit, user.id, scope.accessibleFolderIds, scope.sharedNoteIds)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/app/api/search/route.test.ts`
Expected: PASS — and pre-existing search tests still pass (their notes are authored by the test user).

QA note: confirm Postgres accepts the JS string-array params for `= ANY($n::text[])` with the `@prisma/adapter-pg` driver; if not, fall back to `Prisma.sql`/`Prisma.join` tagged-template queries.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/search
git commit -m "feat(notes): filter search results by resolved access"
```

---

## Task 14: Gate the collab token + add the access claim

**Files:**
- Modify: `apps/web/src/app/api/collab/[noteId]/route.ts`
- Modify: `apps/web/src/app/api/collab/[noteId]/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `collab/[noteId]/route.test.ts`:
```ts
it('403s a token request for a note the user cannot access', async () => {
  const { user: a } = await makeTestUser();
  const { user: b } = await makeTestUser();
  const note = await makeTestNote({ authorId: a.id });
  setAuthed(b);
  const res = await GET(new Request(`http://localhost/api/collab/${note.id}`), {
    params: Promise.resolve({ noteId: note.id }),
  });
  expect(res.status).toBe(403);
});

it('issues a w-token for an editor and an r-token for a viewer', async () => {
  const { user: a } = await makeTestUser();
  const { user: b } = await makeTestUser();
  const note = await makeTestNote({ authorId: a.id });
  await prisma.share.create({
    data: { noteId: note.id, granteeId: b.id, createdById: a.id, access: 'VIEW' },
  });
  setAuthed(a);
  const ownerRes = await GET(new Request(`http://localhost/api/collab/${note.id}`), {
    params: Promise.resolve({ noteId: note.id }),
  });
  expect(((await ownerRes.json()) as { token: string }).token.split(':')[2]).toBe('w');
  setAuthed(b);
  const viewerRes = await GET(new Request(`http://localhost/api/collab/${note.id}`), {
    params: Promise.resolve({ noteId: note.id }),
  });
  expect(((await viewerRes.json()) as { token: string }).token.split(':')[2]).toBe('r');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/collab/[noteId]/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the gate + new token format**

In `apps/web/src/app/api/collab/[noteId]/route.ts`:
- Import `{ atLeast, resolveNoteAccess } from '@/lib/notes/access.ts'`.
- After `if (!note) return jsonError(404, 'note not found');`:
```ts
  const access = await resolveNoteAccess(user.id, noteId);
  if (access === null) return jsonError(403, 'forbidden');
  const tokenAccess = atLeast(access, 'EDIT') ? 'w' : 'r';
```
- Change the payload line to include `tokenAccess`:
```ts
  const payload = `${noteId}:${user.id}:${tokenAccess}:${exp}`;
```
(The signature, `token`, and response shape are otherwise unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/collab/[noteId]/route.test.ts`
Expected: PASS. (If a pre-existing test asserts the 4-segment token shape, update it to expect 5 segments.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/collab
git commit -m "feat(notes): gate collab token by access, carry r/w claim"
```

---

## Task 15: Share + user-search Zod schemas and the TTL helper

**Files:**
- Modify: `apps/web/src/lib/api/schemas.ts`
- Create: `apps/web/src/lib/notes/share-ttl.ts`
- Create: `apps/web/src/lib/notes/share-ttl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/share-ttl.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ttlToExpiresAt } from './share-ttl.ts';

describe('ttlToExpiresAt', () => {
  it('returns null when no ttl is given', () => {
    expect(ttlToExpiresAt(undefined)).toBeNull();
  });

  it('computes a future date for each unit', () => {
    const now = Date.now();
    const mins = ttlToExpiresAt({ value: 30, unit: 'minutes' });
    const hours = ttlToExpiresAt({ value: 2, unit: 'hours' });
    const days = ttlToExpiresAt({ value: 1, unit: 'days' });
    expect(mins?.getTime()).toBeGreaterThanOrEqual(now + 30 * 60_000 - 50);
    expect(hours?.getTime()).toBeGreaterThanOrEqual(now + 2 * 3_600_000 - 50);
    expect(days?.getTime()).toBeGreaterThanOrEqual(now + 86_400_000 - 50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/lib/notes/share-ttl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper and schemas**

Create `apps/web/src/lib/notes/share-ttl.ts`:
```ts
import type { ShareTtl } from '@/lib/api/schemas.ts';

const UNIT_MS: Record<ShareTtl['unit'], number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/** Converts an optional share TTL into an absolute expiry, or null ("forever"). */
export const ttlToExpiresAt = (ttl: ShareTtl | undefined): Date | null => {
  if (!ttl) return null;
  return new Date(Date.now() + ttl.value * UNIT_MS[ttl.unit]);
};
```

Append to `apps/web/src/lib/api/schemas.ts`:
```ts
export const SHARE_ACCESS = ['VIEW', 'EDIT'] as const;
export const SHARE_TTL_UNITS = ['minutes', 'hours', 'days'] as const;

export const shareTtlSchema = z.object({
  value: z.number().int().min(1).max(1000),
  unit: z.enum(SHARE_TTL_UNITS),
});
export type ShareTtl = z.infer<typeof shareTtlSchema>;

export const shareCreateSchema = z.object({
  granteeId: cuidSchema,
  access: z.enum(SHARE_ACCESS),
  ttl: shareTtlSchema.optional(),
});
export type ShareCreateInput = z.infer<typeof shareCreateSchema>;

export const userSearchQuerySchema = z.object({
  q: z.string().min(1).max(100),
});

export type ShareView = {
  id: string;
  grantee: { id: string; displayName: string | null; email: string };
  access: 'VIEW' | 'EDIT';
  expiresAt: string | null;
  createdById: string;
  createdAt: string;
};

export type UserSearchHit = { id: string; displayName: string | null; email: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/lib/notes/share-ttl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/schemas.ts apps/web/src/lib/notes/share-ttl.ts apps/web/src/lib/notes/share-ttl.test.ts
git commit -m "feat(notes): share + user-search schemas, TTL helper"
```

---

## Task 16: Note share-management API

**Files:**
- Create: `apps/web/src/app/api/notes/[id]/shares/route.ts` + `route.test.ts`
- Create: `apps/web/src/app/api/notes/[id]/shares/[shareId]/route.ts` + `route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/notes/[id]/shares/route.test.ts` covering: owner `POST` creates a grant (201/200, audit row `shares.granted`); a re-`POST` to the same grantee upserts (no duplicate row); a non-manager (`VIEW`-grantee / unrelated user) `POST` → 403; `POST` with `granteeId === self` → 400; `GET` by a manager lists active grants; `GET` by a non-manager → 403. Create `[shareId]/route.test.ts` covering: owner `DELETE` revokes any grant; an `EDIT`-grantee may revoke a grant they created but gets 403 revoking one they did not; `DELETE` of a `shareId` that belongs to a different note → 404. Use `makeTestUser`, `makeTestNote`, `makeTestShare`, and the mocked `auth`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/notes/[id]/shares`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement `shares/route.ts`**

Create `apps/web/src/app/api/notes/[id]/shares/route.ts`:
```ts
import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonCreated, jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type ShareView, shareCreateSchema } from '@/lib/api/schemas.ts';
import { canManageShares, resolveNoteAccess } from '@/lib/notes/access.ts';
import { ttlToExpiresAt } from '@/lib/notes/share-ttl.ts';

const log = createLogger({ component: 'api.notes.shares' });
type RouteContext = { params: Promise<{ id: string }> };

const toShareView = (s: {
  id: string;
  access: 'VIEW' | 'EDIT';
  expiresAt: Date | null;
  createdById: string;
  createdAt: Date;
  grantee: { id: string; displayName: string | null; email: string };
}): ShareView => ({
  id: s.id,
  grantee: s.grantee,
  access: s.access,
  expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
  createdById: s.createdById,
  createdAt: s.createdAt.toISOString(),
});

const shareInclude = {
  grantee: { select: { id: true, displayName: true, email: true } },
} as const;

export const GET = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const note = await prisma.note.findUnique({ where: { id }, select: { id: true } });
  if (!note) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (!canManageShares(access)) return jsonError(403, 'forbidden');

  const shares = await prisma.share.findMany({
    where: {
      noteId: id,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: shareInclude,
    orderBy: { createdAt: 'asc' },
  });
  return jsonOk({ shares: shares.map(toShareView) });
};

export const POST = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  const note = await prisma.note.findUnique({ where: { id }, select: { id: true } });
  if (!note) return jsonError(404, 'not found');
  const access = await resolveNoteAccess(user.id, id);
  if (!canManageShares(access)) return jsonError(403, 'forbidden');

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = shareCreateSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);
  const { granteeId, access: level, ttl } = parsed.data;
  if (granteeId === user.id) return jsonError(400, 'cannot share with yourself');

  const grantee = await prisma.user.findUnique({ where: { id: granteeId }, select: { id: true } });
  if (!grantee) return jsonError(400, 'unknown grantee');

  const expiresAt = ttlToExpiresAt(ttl);
  const share = await prisma.share.upsert({
    where: { noteId_granteeId: { noteId: id, granteeId } },
    create: { noteId: id, granteeId, access: level, expiresAt, createdById: user.id },
    update: { access: level, expiresAt, createdById: user.id },
    include: shareInclude,
  });
  await recordAudit({
    action: 'shares.granted',
    actorId: user.id,
    subject: share.id,
    metadata: { noteId: id, granteeId, access: level },
  });
  log.info({ shareId: share.id, noteId: id, granteeId }, 'note share granted');
  return jsonCreated(toShareView(share));
};
```

- [ ] **Step 4: Implement `shares/[shareId]/route.ts`**

Create `apps/web/src/app/api/notes/[id]/shares/[shareId]/route.ts`:
```ts
import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { resolveNoteAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.notes.shares.id' });
type RouteContext = { params: Promise<{ id: string; shareId: string }> };

export const DELETE = async (_req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id, shareId } = await ctx.params;

  const share = await prisma.share.findUnique({
    where: { id: shareId },
    select: { id: true, noteId: true, createdById: true },
  });
  if (!share || share.noteId !== id) return jsonError(404, 'not found');

  const access = await resolveNoteAccess(user.id, id);
  // Owner may revoke any share; an EDIT-grantee only shares they created.
  const allowed =
    access === 'OWNER' || (access === 'EDIT' && share.createdById === user.id);
  if (!allowed) return jsonError(403, 'forbidden');

  await prisma.share.delete({ where: { id: shareId } });
  await recordAudit({
    action: 'shares.revoked',
    actorId: user.id,
    subject: shareId,
    metadata: { noteId: id },
  });
  log.info({ shareId, noteId: id, userId: user.id }, 'note share revoked');
  return jsonOk({ revoked: true });
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/notes/[id]/shares`
Expected: PASS.

- [ ] **Step 6: Add to coverage `include`, then commit**

Add both new route files to `vitest.config.ts` coverage `include`. Then:
```bash
git add apps/web/src/app/api/notes/[id]/shares vitest.config.ts
git commit -m "feat(notes): note share-management API"
```

---

## Task 17: Folder share-management API

**Files:**
- Create: `apps/web/src/app/api/folders/[id]/shares/route.ts` + `route.test.ts`
- Create: `apps/web/src/app/api/folders/[id]/shares/[shareId]/route.ts` + `route.test.ts`

- [ ] **Step 1: Write the failing tests**

Mirror Task 16's tests against folders: use `makeTestFolder` instead of `makeTestNote`; a folder-`EDIT` grant via `makeTestShare({ folderId, ... })` makes user B a manager; verify inheritance — a manager of a parent folder may also `GET`/`POST` shares on a child folder.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run apps/web/src/app/api/folders/[id]/shares`
Expected: FAIL.

- [ ] **Step 3: Implement the folder share routes**

Create `apps/web/src/app/api/folders/[id]/shares/route.ts` and `.../[shareId]/route.ts` as exact copies of the Task 16 files with these substitutions: `resolveNoteAccess` → `resolveFolderAccess`; `prisma.note.findUnique` → `prisma.folder.findUnique`; the upsert `where` selector `noteId_granteeId` → `folderId_granteeId` and `noteId` → `folderId` in `create`/`update`/`findMany`; audit metadata key `noteId` → `folderId`; logger component `'api.folders.shares'` / `'api.folders.shares.id'`; the `[shareId]` route checks `share.folderId !== id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run apps/web/src/app/api/folders/[id]/shares`
Expected: PASS.

- [ ] **Step 5: Add to coverage `include`, then commit**

```bash
git add apps/web/src/app/api/folders/[id]/shares vitest.config.ts
git commit -m "feat(notes): folder share-management API"
```

---

## Task 18: User-search API

**Files:**
- Create: `apps/web/src/app/api/users/route.ts` + `route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/api/users/route.test.ts` covering: 401 unauthed; a query matching another user's `displayName` or `email` returns that user; the caller is excluded from results; `q` shorter than 1 char → 400.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/web/src/app/api/users/route.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/users/route.ts`:
```ts
import { prisma } from '@app/db';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { type UserSearchHit, userSearchQuerySchema } from '@/lib/api/schemas.ts';

const RESULT_LIMIT = 20;

/** GET /api/users?q= — searches the User mirror for share-dialog grantee picking. */
export const GET = async (req: Request): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const parsed = userSearchQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);
  const { q } = parsed.data;

  const users = await prisma.user.findMany({
    where: {
      id: { not: user.id },
      OR: [
        { displayName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, displayName: true, email: true },
    orderBy: { displayName: 'asc' },
    take: RESULT_LIMIT,
  });
  return jsonOk({ users: users satisfies UserSearchHit[] });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/web/src/app/api/users/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Add to coverage `include`, then commit**

```bash
git add apps/web/src/app/api/users vitest.config.ts
git commit -m "feat(notes): user-search API for share dialog"
```

---

## Task 19: Worker — y-websocket token carries an access claim

**Files:**
- Modify: `apps/worker/src/yjs/token.ts`
- Modify: `apps/worker/src/yjs/token.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/worker/src/yjs/token.test.ts`, update existing `issueToken` calls to pass `access: 'w'`, and add:
```ts
it('round-trips the access claim', () => {
  const token = issueToken({ secret: SECRET, noteId: 'n1', userId: 'u1', access: 'r' });
  const parsed = verifyToken({ secret: SECRET, token });
  expect(parsed?.access).toBe('r');
});

it('rejects a token whose access segment is not r/w', () => {
  const token = issueToken({ secret: SECRET, noteId: 'n1', userId: 'u1', access: 'w' });
  const tampered = token.replace(':w:', ':x:');
  expect(verifyToken({ secret: SECRET, token: tampered })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/worker/src/yjs/token.test.ts`
Expected: FAIL — `issueToken` has no `access` param; `ParsedToken` has no `access`.

- [ ] **Step 3: Update `token.ts`**

In `apps/worker/src/yjs/token.ts`:
- Update the format docstring to `${noteId}:${userId}:${access}:${exp}:${sig}`.
- `ParsedToken` gains `access: 'r' | 'w'`.
- `issueToken` input gains `access: 'r' | 'w'`; the payload becomes `` `${input.noteId}:${input.userId}:${input.access}:${exp}` ``.
- `verifyToken`: `if (parts.length !== 5) return null;` then destructure `[noteId, userId, access, expStr, sig]`; `if (access !== 'r' && access !== 'w') return null;`; the verified payload is `` `${noteId}:${userId}:${access}:${exp}` ``; return `{ noteId, userId, access, exp }` (cast `access` to `'r' | 'w'`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/worker/src/yjs/token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/yjs/token.ts apps/worker/src/yjs/token.test.ts
git commit -m "feat(worker): collab token carries r/w access claim"
```

---

## Task 20: Worker — enforce read-only collab sessions

**Files:**
- Modify: `apps/worker/src/yjs/server.ts`
- Modify: `apps/worker/src/yjs/server.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

In `apps/worker/src/yjs/server.test.ts`, add a test: build a `PerSocket` with `access: 'r'`, call `handleMessage` with a `sync-update` message, and assert the in-memory `Y.Doc` for that note is unchanged (use `getDocForNote` + `Y.encodeStateVector`, or assert `broadcastToRoom` did not fire by checking a peer socket received nothing). Add a companion test that `access: 'w'` does apply the update. Mirror the existing `server.test.ts` setup (it already imports `_resetForTests`, `handleMessage`, `parseMessage`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run apps/worker/src/yjs/server.test.ts`
Expected: FAIL — `PerSocket` has no `access`; updates are applied regardless.

- [ ] **Step 3: Implement read-only enforcement**

In `apps/worker/src/yjs/server.ts`:
- Add `access: 'r' | 'w'` to the `PerSocket` type.
- Add `access: 'r' | 'w'` to the `AuthResult` `ok: true` variant; `authenticateUpgrade` returns `access: parsed.access` in the success object.
- In `handleMessage`, at the start of the `sync-step-2 | sync-update` branch:
```ts
  if (msg.kind === 'sync-step-2' || msg.kind === 'sync-update') {
    if (conn.access === 'r') {
      log.warn(
        { noteId: conn.noteId, userId: conn.userId },
        'dropping document update from read-only connection',
      );
      return;
    }
    Y.applyUpdate(doc, msg.update, conn);
    broadcastToRoom(conn.noteId, conn, encodeUpdate(msg.update));
    await scheduleSnapshot(conn.noteId, conn.userId);
    return;
  }
```
(`sync-step-1` and `awareness` are untouched — read-only clients still receive the document and relay presence.)

In `apps/worker/src/index.ts`:
- The `WsAttach` type's `conn` gains `access: 'r' | 'w'`.
- In `fetch`, the `server.upgrade` `data.conn` gains `access: result.access`.
- The `onSocketOpen` and `handleMessage` `conn` objects in `open`/`message` gain `access: ws.data.conn.access`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run apps/worker/src/yjs`
Expected: PASS.

- [ ] **Step 5: Typecheck the worker and commit**

Run: `bun --filter @app/worker typecheck`
Expected: PASS.
```bash
git add apps/worker/src
git commit -m "feat(worker): enforce read-only collab for view-only grants"
```

---

## Task 21: UI — api-client `sharesApi`/`usersApi`, `ExpiryPicker`, `useShares`

**Files:**
- Modify: `apps/web/src/lib/notes/api-client.ts`
- Create: `apps/web/src/components/notes/Share/ExpiryPicker.tsx` + `ExpiryPicker.test.tsx`
- Create: `apps/web/src/components/notes/Share/useShares.ts` + `useShares.test.ts`

- [ ] **Step 1: Extend the api-client**

Append to `apps/web/src/lib/notes/api-client.ts` (add `ShareCreateInput`, `ShareView`, `UserSearchHit` to the type import from `@/lib/api/schemas.ts`):
```ts
type ShareScope = { kind: 'note' | 'folder'; id: string };

const sharesBase = (s: ShareScope): string =>
  s.kind === 'note' ? `/api/notes/${s.id}/shares` : `/api/folders/${s.id}/shares`;

export const sharesApi = {
  list: (scope: ShareScope, fetcher?: typeof fetch): Promise<{ shares: ShareView[] }> =>
    request(sharesBase(scope), fetcher ? { fetcher } : {}),
  create: (
    scope: ShareScope,
    input: ShareCreateInput,
    fetcher?: typeof fetch,
  ): Promise<ShareView> =>
    request(sharesBase(scope), {
      method: 'POST',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  revoke: (
    scope: ShareScope,
    shareId: string,
    fetcher?: typeof fetch,
  ): Promise<{ revoked: true }> =>
    request(`${sharesBase(scope)}/${shareId}`, {
      method: 'DELETE',
      ...(fetcher ? { fetcher } : {}),
    }),
};

export const usersApi = {
  search: (q: string, fetcher?: typeof fetch): Promise<{ users: UserSearchHit[] }> =>
    request(`/api/users?q=${encodeURIComponent(q)}`, fetcher ? { fetcher } : {}),
};
```
Run `bun run vitest run apps/web/src/lib/notes/api-client.test.ts` — Expected: PASS (existing tests unaffected). Commit:
```bash
git add apps/web/src/lib/notes/api-client.ts
git commit -m "feat(notes): sharesApi + usersApi client wrappers"
```

- [ ] **Step 2: Write the failing `ExpiryPicker` test**

Create `ExpiryPicker.test.tsx`. `ExpiryPicker` is a controlled component: props `{ value: ShareTtl | undefined; onChange: (ttl: ShareTtl | undefined) => void }`. Test (with `@testing-library/react`, matching `CopyMarkdownButton.test.tsx` setup): rendering with `value=undefined` shows the "forever" state; toggling to a duration calls `onChange` with `{ value, unit }`; changing the unit select calls `onChange` with the new unit.

- [ ] **Step 3: Run it — Expected: FAIL (module missing).**

- [ ] **Step 4: Implement `ExpiryPicker.tsx`**

A `'use client'` component: a checkbox/toggle "Share forever" (checked → `onChange(undefined)`); when unchecked, a numeric `<input>` (1–1000) and a `<select>` of `minutes | hours | days`, both wired to call `onChange({ value, unit })`. Use `useTranslations('notes.share')` for labels (keys added in Task 23). Match the repo's Tailwind/shadcn styling conventions seen in `apps/web/src/components/notes/Editor`.

- [ ] **Step 5: Run the test — Expected: PASS. Commit.**

```bash
git add apps/web/src/components/notes/Share/ExpiryPicker.tsx apps/web/src/components/notes/Share/ExpiryPicker.test.tsx
git commit -m "feat(notes): ExpiryPicker component"
```

- [ ] **Step 6: Write the failing `useShares` test**

`useShares(scope)` returns `{ shares, loading, error, reload, create, revoke }`, wrapping `sharesApi`. Test with a stubbed `fetch`/injected fetcher: initial load populates `shares`; `create` posts then reloads; `revoke` deletes then reloads. Follow the hook-test pattern in `apps/web/src/lib/notes/use-doc-panel.test.ts`.

- [ ] **Step 7: Run it — Expected: FAIL.**

- [ ] **Step 8: Implement `useShares.ts`**

A `'use client'` hook using `useState`/`useEffect`/`useCallback` around `sharesApi.list/create/revoke`. On mount and after each mutation, refetch the list. Surface `ApiError` messages via the `error` field.

- [ ] **Step 9: Run the test — Expected: PASS. Commit.**

```bash
git add apps/web/src/components/notes/Share/useShares.ts apps/web/src/components/notes/Share/useShares.test.ts vitest.config.ts
git commit -m "feat(notes): useShares hook"
```
(Add `ExpiryPicker.tsx`, `useShares.ts` to `vitest.config.ts` coverage `include` before committing.)

---

## Task 22: UI — `ShareDialog`

**Files:**
- Create: `apps/web/src/components/notes/Share/ShareDialog.tsx` + `ShareDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `ShareDialog.test.tsx`. `ShareDialog` props: `{ scope: { kind: 'note' | 'folder'; id: string }; canManage: boolean; onClose: () => void }`. With an injected fetcher returning a fixed share list, assert: the current grants render (grantee name, a `VIEW`/`EDIT` badge, expiry text); the "add people" form is present when `canManage` is true and absent otherwise; selecting a searched user + access + clicking "Add" calls `sharesApi.create`; clicking a grant's revoke control calls `sharesApi.revoke`.

- [ ] **Step 2: Run it — Expected: FAIL (module missing).**

- [ ] **Step 3: Implement `ShareDialog.tsx`**

A `'use client'` dialog (reuse the project's existing modal/dialog primitive — check `apps/web/src/components/notes/Editor` and `components/ui` for the shadcn `Dialog`). Composition:
- Header: title from `useTranslations('notes.share')`, a close button calling `onClose`.
- **Current access** section: `useShares(scope).shares` mapped to rows — grantee `displayName ?? email`, a `VIEW`/`EDIT` badge, expiry rendered as a relative countdown (or "forever" when `expiresAt` is null), and a revoke button per row (shown when `canManage`).
- **Add people** section (only when `canManage`): a user-search combobox backed by `usersApi.search` (debounce input with the existing `debounce` util in `lib/notes/debounce.ts`), an access `<select>` (`VIEW`/`EDIT`), an `<ExpiryPicker>`, and an "Add" button calling `useShares().create({ granteeId, access, ttl })`.
- Surface `error` from `useShares` as an inline message.
All user-facing strings via `useTranslations`. Match the visual language of the existing editor components (paper-line borders, rounded, muted-foreground).

- [ ] **Step 4: Run the test — Expected: PASS.**

- [ ] **Step 5: Add to coverage `include`, then commit**

```bash
git add apps/web/src/components/notes/Share/ShareDialog.tsx apps/web/src/components/notes/Share/ShareDialog.test.tsx vitest.config.ts
git commit -m "feat(notes): ShareDialog component"
```

---

## Task 23: UI — eye icon in the sidebar + i18n

**Files:**
- Modify: `apps/web/src/components/notes/Sidebar/FolderTree.tsx` + `FolderTree.test.tsx`
- Modify: the notes-list row component (locate via `grep -rln "NoteListItem" apps/web/src/components`)
- Modify: `apps/web/messages/de.json`, `apps/web/messages/en.json`

- [ ] **Step 1: Add the i18n keys**

Add a `notes.share` namespace to **both** `apps/web/messages/de.json` and `apps/web/messages/en.json` with identical keys. Required keys: `title`, `currentAccess`, `addPeople`, `accessView`, `accessEdit`, `shareForever`, `expiresIn`, `unitMinutes`, `unitHours`, `unitDays`, `add`, `revoke`, `searchPeoplePlaceholder`, `noShares`, `sharedIndicatorLabel` (the eye icon's `aria-label`). Provide German and English wordings respectively.

- [ ] **Step 2: Write the failing test**

In `FolderTree.test.tsx`, add a test: a folder node with `shareCount > 0` renders an element with the `sharedIndicatorLabel` accessible name; clicking it invokes the provided open-share-dialog handler. Add an equivalent test to the notes-list row component's test file.

- [ ] **Step 3: Run it — Expected: FAIL.**

- [ ] **Step 4: Implement the eye icon**

In `FolderTree.tsx` and the notes-list row component: when the node's `shareCount > 0`, render a small eye-icon button (low-opacity, brightening on hover/focus — mirror the `CopyMarkdownButton` affordance pattern from `docs/issues/2026-05-16-copy-markdown-button-placement.md`), with `aria-label` from `t('notes.share.sharedIndicatorLabel')`. Clicking it opens `ShareDialog` for that resource (`scope={{ kind, id }}`), passing `canManage` — true when the current user owns or has edit access; for v1 derive `canManage` from whether the resource is the user's own (the row already knows `authorId`/`ownerId`) or pass it down from the page. Render `ShareDialog` at the sidebar root with open-state managed there.

- [ ] **Step 5: Run the tests — Expected: PASS.**

- [ ] **Step 6: Verify i18n parity and commit**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar` and confirm both message files have matching keys (the `i18n-extractor` subagent / existing i18n test catches drift).
```bash
git add apps/web/src/components/notes apps/web/messages
git commit -m "feat(notes): eye icon share indicator + i18n"
```

---

## Task 24: ADR, schema-comment correction, docs, full verification

**Files:**
- Create: `docs/adr/0026-explicit-resource-sharing.md`
- Modify: `docs/adr/README.md`
- Modify: `CLAUDE.md` (auth section note)

- [ ] **Step 1: Write ADR 0026**

Create `docs/adr/0026-explicit-resource-sharing.md` following the MADR-lite format of the other ADRs (see `0025-asset-cleanup.md`). **Status:** Accepted. **Context:** notes/folders were world-readable/writable; the v1 "all users see all notes" model is replaced. **Decision:** private-by-default; `Share` table (one table, two nullable FKs, XOR `CHECK`); `Folder.ownerId`; folder ownership and folder shares cascade downward; no admin/ops bypass; owner + edit-grantees manage shares (non-owners revoke only own-created); denied = 403; lazy expiry. Include a **"Relationship to ADR 0022"** section: the y-websocket token now carries an `r`/`w` access claim and the worker enforces read-only sessions. **Consequences:** include the no-break-glass risk (a folderless note whose author is deactivated becomes inaccessible).

- [ ] **Step 2: Update the ADR index**

In `docs/adr/README.md`, add to the index table:
`| 0026 | Explicit per-resource sharing model (notes & folders) | Accepted |`

- [ ] **Step 3: Note the model change in `CLAUDE.md`**

In `CLAUDE.md`, under the auth section, add a short paragraph: notes and folders are private by default with explicit `Share`-based grants — see ADR 0026 and `apps/web/src/lib/notes/access.ts`; the resolution engine is the single authorization source for the notes domain.

- [ ] **Step 4: Full verification**

Run the whole suite and gates:
```
bun run vitest run
bun run typecheck
```
Expected: PASS, with coverage meeting the ≥ 90 % / ≥ 80 % gate. If coverage fails, add the missing new files to `vitest.config.ts` `include` and add the missing test cases.

- [ ] **Step 5: Commit**

```bash
git add docs/adr CLAUDE.md vitest.config.ts
git commit -m "docs(notes): ADR 0026 for the resource-sharing model"
```

---

## Self-Review

**Spec coverage:**
- Private-by-default + ownership → Task 1 (`Folder.ownerId`), Tasks 3–7 (engine).
- `Share` table + XOR check + cascade → Task 1.
- Folder ownership cascades downward as OWNER → Tasks 5–7 (resolver tests assert it).
- Resolution engine → Tasks 3–7.
- API enforcement (all routes in the spec table) → Tasks 8–14.
- 403 for denied, 404 for missing → Tasks 8–14 (each guard returns 403 after a 404 existence check).
- Share-management API (note + folder, create/list/revoke) → Tasks 16–17.
- User search → Task 18.
- Collab token access claim + worker read-only → Tasks 14, 19, 20.
- Search filtering → Task 13.
- `shareCount` on list responses → Tasks 10, 12.
- UI (ShareDialog, ExpiryPicker, eye icon, i18n) → Tasks 21–23.
- ADR 0026 + schema-comment correction + docs → Tasks 1 (comment), 24.
- Lazy expiry → engine `activeShareWhere` (Tasks 5–7); no sweep job (spec non-goal).

**Placeholder scan:** No "TBD"/"implement later". UI tasks (21–23) reference reading existing components for visual conventions — intentional, as the repo's component styling is the pattern to match; prop interfaces and data flow are fully specified.

**Type consistency:** `Access` (`OWNER|EDIT|VIEW`) and `null` used consistently; `atLeast/canEdit/canManageShares/canHardDelete` defined in Task 3, used unchanged in Tasks 8–17. `ShareView`/`ShareCreateInput`/`ShareTtl`/`UserSearchHit` defined in Task 15, consumed in Tasks 16–18, 21–22. `resolveNoteAccess`/`resolveFolderAccess`/`listAccessibleScope`/`folderChain` signatures stable across all consumers. Token `access` (`'r'|'w'`) consistent across Tasks 14, 19, 20.
