# Explicit Resource Sharing — notes & folders

**Date:** 2026-05-16
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `packages/db` schema, `apps/web` notes/assets/folders/collab/search API + UI, `apps/worker` y-websocket, `docs/adr`

## Context

A sub-project D review flagged that the notes REST API authenticates but does
not authorise: any logged-in user can read, edit, archive, delete, or
body-save any note by id. Brainstorming widened both the diagnosis and the
fix.

The diagnosis: the gap is **not** limited to `notes/[id]` and
`notes/[id]/body`. Every path that reaches a note or folder is unguarded —
the folders API, the collab-token endpoint, and full-text search included.
The `Note` model already carries `authorId`; `Folder` has **no owner column**
at all.

The fix: the project owner decided the model is not "lock the existing
behaviour" but a new product capability — **notes and folders are private by
default and can be explicitly shared** with named users, for view or edit,
optionally time-limited. This supersedes the v1 model recorded in
`schema.prisma` ("the sharing model in v1 is 'all users see all notes'") and
must be reconciled with ADR 0022 (real-time collaboration), which currently
issues a y-websocket token to any authenticated user for any note.

## Problem

1. **No authorisation.** Authentication ≠ authorisation. Every notes, assets,
   folders, collab-token, and search handler trusts any session.
2. **No ownership for folders.** Sharing a folder needs an owner to decide who
   may share it; the `Folder` model has none.
3. **No sharing primitive.** There is no way to express "user B may view note
   N" or "user B may edit folder F until Friday."
4. **Realtime bypass.** Even with the REST API locked, `GET /api/collab/[noteId]`
   would still hand any user an edit token for any note.
5. **Search leak.** `GET /api/search` runs raw SQL across every note; unfiltered
   it returns private titles, bodies, and snippets to anyone.

## Goals

1. Notes and folders are **private by default** — only the owner has access.
2. An owner (or an edit-grantee) can **share** a note or folder with named
   users at **view** or **edit** access.
3. Sharing a folder **cascades down** its subtree: every sub-folder and note
   beneath a shared folder inherits that access.
4. A share can carry an **expiry** (a duration in minutes / hours / days);
   default is no expiry ("forever").
5. Every note/folder/asset/collab/search code path **enforces** the resolved
   access; unauthorised access returns **403**.
6. A shared resource shows an **eye icon**; opening it lists who has access,
   at what level, and until when, and is where shares are added/revoked.

## Decisions (resolved during brainstorming)

- **Private by default.** Ownership: `Note.authorId` (exists),
  `Folder.ownerId` (new). This **supersedes** the `schema.prisma` "all users
  see all notes" comment, which is corrected as part of this work.
- **Folder ownership cascades downward as `OWNER`.** Owning a folder confers
  `OWNER` access to every sub-folder and note within it. Rationale: a folder
  owner who grants another user edit access (so they can file notes into the
  folder) must still see those notes; and it keeps the model MECE — "access
  flows down the tree" applies to ownership and to shares identically. A note
  therefore has up to two owners: its author and the owner of any ancestor
  folder. A note with no folder is private to its author alone.
- **No role bypass.** `admin` / `ops` get **no** implicit access — they are
  bound by ownership and shares like everyone else. Break-glass admin access
  is a documented non-goal (see Risks).
- **Owner + edit-grantees can manage shares.** Anyone with effective `OWNER`
  or `EDIT` on a resource may create shares. Revoke rule: an owner may revoke
  any share; a non-owner manager may revoke only shares they created
  (`Share.createdById`).
- **Denied = 403.** A resource that exists but is not accessible returns
  `403`. A genuinely missing id still returns `404`. (The owner accepted the
  id-existence leak in exchange for honest, debuggable responses.)
- **Single combined spec.** One spec and one plan cover schema → engine →
  enforcement → share API → collab/search → UI.
- **Share data model: one `Share` table, two nullable FKs** (`noteId?`,
  `folderId?`) with a DB `CHECK` enforcing exactly-one. Chosen over two
  tables (duplicated engine + endpoints) and over a polymorphic
  `resourceType`+`resourceId` (no FK integrity, no cascade).
- **Resolution walks the folder tree in app code**, iteratively, with a cycle
  guard — folder trees are shallow and a pure function is easy to test. A
  recursive SQL CTE is the documented escape hatch if depth ever grows.
- **Lazy expiry.** An expired share simply stops granting access
  (`expiresAt IS NULL OR expiresAt > now()`); no sweep job in v1 — expired
  rows are harmless and visible in the UI.
- **This work gets ADR 0026.** It records private-by-default, the `Share`
  design, folder ownership, downward cascade, no-bypass, 403, lazy expiry,
  and its relationship to ADR 0022.

## Non-goals

- Sharing with **roles or groups** — v1 shares with named individual users
  only. (A user is shareable only once they exist in the `User` mirror, i.e.
  after their first login.)
- A **share-expiry sweep job**. Expired shares are filtered at query time and
  left in the table.
- **Email / in-app notifications** when a resource is shared.
- **Break-glass admin access.** With no role bypass, a note with no folder
  whose author is deactivated and which was never shared becomes
  inaccessible. Accepted; a future ADR may add a recovery path.
- **Cross-note asset reuse** — unchanged pre-existing non-goal.
- **Tags** stay global (the `Tag` model is intentionally not per-user); the
  `tags` API is out of scope.
- Public / link-based ("anyone with the link") sharing.

## Design

### 1. Schema & migration (`packages/db/prisma/schema.prisma`)

New enum and model, plus one new column on `Folder`:

```prisma
enum ShareAccess {
  VIEW
  EDIT
}

/// An explicit grant of access to a single Note OR a single Folder.
/// Exactly one of noteId / folderId is set (DB CHECK constraint).
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

- `Folder` gains `ownerId String` + `owner User @relation("folder_owner", …)`
  and `shares Share[]`.
- `Note` gains `shares Share[]`.
- `User` gains `ownedFolders Folder[] @relation("folder_owner")`,
  `sharesReceived Share[] @relation("share_grantee")`,
  `sharesCreated Share[] @relation("share_creator")`.
- `@@unique([noteId, granteeId])` / `@@unique([folderId, granteeId])`:
  Postgres treats `NULL`s as distinct, so a re-share of the same grantee is an
  **upsert** (update access/expiry), never a duplicate row.

**Raw-SQL block** appended to the generated migration (the repo already does
raw SQL for `tsvector`):

```sql
ALTER TABLE "Share" ADD CONSTRAINT "Share_exactly_one_target"
  CHECK (("noteId" IS NOT NULL) <> ("folderId" IS NOT NULL));
```

**`Folder.ownerId` backfill** — the one irreversible data step, **needs
explicit sign-off**:

```sql
ALTER TABLE "Folder" ADD COLUMN "ownerId" TEXT;
-- owner = author of the folder's most-recently-updated note
UPDATE "Folder" f SET "ownerId" =
  (SELECT n."authorId" FROM "Note" n
    WHERE n."folderId" = f.id ORDER BY n."updatedAt" DESC LIMIT 1);
-- folders with no notes: fall back to the earliest-created user
UPDATE "Folder" SET "ownerId" =
  (SELECT id FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
  WHERE "ownerId" IS NULL;
ALTER TABLE "Folder" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE RESTRICT;
```

If the development DB holds only throwaway data, resetting it is the simpler
path; the backfill above exists for any environment with real folders. The
`db-migration-reviewer` subagent reviews this migration.

### 2. Permission-resolution engine — `apps/web/src/lib/notes/access.ts`

A new, focused, independently tested module. The only place access rules
live.

```ts
export type Access = 'OWNER' | 'EDIT' | 'VIEW';   // resolvers return Access | null
```

Rank `OWNER > EDIT > VIEW`. Helpers: `atLeast(access, min)`,
`canEdit(access)` (`OWNER|EDIT`), `canManageShares(access)` (`OWNER|EDIT`),
`canHardDelete(access)` (`OWNER`).

- **`folderChain(folderId)`** — walks `parentId` from a folder upward,
  returning `[{ id, ownerId }]` for the folder and every ancestor. A `visited`
  set + depth cap (64) guard against cycles.
- **`resolveNoteAccess(userId, noteId): Access | null`**
  1. Load `note { authorId, folderId }`; missing → `null`.
  2. `authorId === userId` → `OWNER`.
  3. Any ancestor folder `ownerId === userId` → `OWNER`.
  4. Otherwise `max` of active `Share`s to `userId` on the note **or** any
     ancestor folder → `EDIT` / `VIEW`.
  5. No match → `null`.
- **`resolveFolderAccess(userId, folderId): Access | null`** — same, over the
  folder itself and its ancestors.
- **`listAccessibleScope(userId)`** — for list & search filtering. Loads all
  folders `{ id, parentId, ownerId }` (a small table), computes
  `accessibleFolderIds` = (owned folders ∪ folders shared to the user),
  expanded to **all descendants** via an in-memory child map; and
  `sharedNoteIds` = note-scoped active shares to the user. A note is
  accessible iff `authorId = userId OR folderId ∈ accessibleFolderIds OR
  id ∈ sharedNoteIds`.
- **"Active"** = `expiresAt IS NULL OR expiresAt > now()`, applied in every
  `Share` query.

### 3. API enforcement

Each handler resolves access immediately after `requireSession()` and the
404-existence check, then gates on the required level. Insufficient access →
`jsonError(403, 'forbidden')`. Handlers return `jsonError(...)` directly (the
repo's route handlers do not use the `ForbiddenError` + error-boundary
pattern).

| Path | Method | Required access |
|---|---|---|
| `/api/notes` | `GET` (list) | filtered to `listAccessibleScope` |
| `/api/notes` | `POST` | authed; `folderId` set → `EDIT` on that folder; sets `authorId` = caller |
| `/api/notes/[id]` | `GET` | `VIEW` |
| `/api/notes/[id]` | `PATCH` | `EDIT`; moving to a folder → also `EDIT` on the target folder |
| `/api/notes/[id]` | `DELETE` (archive) | `EDIT` |
| `/api/notes/[id]` | `DELETE ?hard=1` | `OWNER` |
| `/api/notes/[id]/body` | `PUT` | `EDIT` |
| `/api/notes/[id]/history` | `GET` | `VIEW` |
| `/api/notes/[id]/assets` | `POST` (upload) | `EDIT` on the note |
| `/api/assets/[id]` | `GET` (bytes) | `VIEW` on `asset.note` |
| `/api/assets/[id]` | `PATCH` (caption) | `EDIT` on `asset.note` |
| `/api/assets/[id]/preview` | `GET` | `VIEW` on `asset.note` |
| `/api/collab/[noteId]` | `GET` (token) | `VIEW`; token carries `r`/`w` (§5) |
| `/api/search` | `GET` | filtered to `listAccessibleScope` |
| `/api/folders` | `GET` (list) | filtered to `listAccessibleScope` |
| `/api/folders` | `POST` | authed; `parentId` set → `EDIT` on parent; sets `ownerId` = caller |
| `/api/folders/[id]` | `GET` | `VIEW` |
| `/api/folders/[id]` | `PATCH` | `EDIT`; reparenting → also `EDIT` on the target parent |
| `/api/folders/[id]` | `DELETE` | `OWNER` (still requires the folder be empty) |
| `/api/folders/reorder` | `PATCH` | `EDIT` on every affected folder |
| `/api/tags`, `/api/tags/[id]` | * | unchanged — out of scope |

The notes-list and folders-list responses gain a `shareCount` field (count of
**active** shares on the resource) so the UI can render the eye icon without
an extra request.

### 4. Share-management & user-search API

New route handlers, nested under the resource (matching `/api/notes/[id]/assets`):

- **`GET /api/notes/[id]/shares`** — list grants on the note. Requires
  `canManageShares`. Returns `{ shares: [{ id, grantee: { id, displayName,
  email }, access, expiresAt, createdById, createdAt }] }`.
- **`POST /api/notes/[id]/shares`** — create or update a grant. Requires
  `canManageShares`. Body (`shareCreateSchema`):
  `{ granteeId, access: 'VIEW'|'EDIT', ttl?: { value: 1..1000, unit:
  'minutes'|'hours'|'days' } }`. `expiresAt` = `ttl ? now + duration : null`.
  Upserts on `(noteId, granteeId)`. Cannot share to self.
- **`DELETE /api/notes/[id]/shares/[shareId]`** — revoke. Owner: any share;
  non-owner manager: only own-created shares (else `403`).
- The **`/api/folders/[id]/shares`** trio mirrors the above exactly.
- **`GET /api/users?q=`** — searches the `User` mirror by `displayName` /
  `email` (case-insensitive, capped result count) so the share dialog can
  pick a grantee. Authenticated; returns `{ users: [{ id, displayName,
  email }] }`. Excludes the caller.

All grant create/revoke calls `recordAudit` (`shares.granted`,
`shares.revoked`) with `actorId`, `subject` = share id, and resource metadata.

New Zod schemas + types in `apps/web/src/lib/api/schemas.ts`:
`shareCreateSchema`, `ShareTtl`, `ShareView`, `userSearchQuerySchema`,
`UserSearchHit`.

### 5. Collab token & search

**Collab.** The y-websocket token must express read-only, or a `VIEW`-only
user could still edit live and bypass the REST lock.

- Token payload becomes `noteId:userId:access:exp` (`access` ∈ `r` | `w`) —
  `apps/worker/src/yjs/token.ts` `issueToken` / `verifyToken` updated; both
  values are colon-free so the existing parser holds.
- `GET /api/collab/[noteId]` calls `resolveNoteAccess`: `null` → `403`;
  `VIEW` → token `access = r`; `EDIT` / `OWNER` → `access = w`.
- The worker (`apps/worker/src/index.ts`) reads `access` from the verified
  token and, for `r` connections, **drops inbound document updates** —
  the client receives the document and presence but cannot mutate it.
- This changes the ADR-0022 token contract; ADR 0026 carries a "Relationship
  to ADR 0022" section and ADR 0022 is cross-referenced.

**Search.** `apps/web/src/app/api/search/route.ts` computes
`listAccessibleScope` first, then injects an access predicate into all three
raw queries (the tsvector note query, the asset-join query, the trigram
fallback):

```sql
AND (n."authorId" = $u OR n."folderId" = ANY($folderIds::text[])
     OR n.id = ANY($noteIds::text[]))
```

passed as positional parameters — no string interpolation of ids.

### 6. UI — share dialog & eye icon

Under `apps/web/src/components/notes/Share/` (new):

- **`ShareDialog.tsx`** — one dialog for notes and folders. Sections:
  - **Current access** — the grant list: grantee name + email, a `VIEW`/`EDIT`
    badge, expiry as a countdown or "forever", and a revoke control (shown
    only where the caller may revoke that grant).
  - **Add people** — a user-search combobox (`GET /api/users?q=`), an
    access select (`VIEW`/`EDIT`), and an expiry picker.
- **`ExpiryPicker.tsx`** — a "forever" default plus a numeric amount and a
  Minutes / Hours / Days unit select.
- **`useShares.ts`** — hook wrapping the share endpoints (list / create /
  revoke) for one resource.
- **Eye icon** — added to the note-list row and folder-tree row components
  in `apps/web/src/components/notes/Sidebar/`. Rendered when
  `shareCount > 0`; clicking opens `ShareDialog` for that resource.
- The fetch layer (`apps/web/src/lib/notes/api-client.ts`) gains
  `sharesApi` (list/create/revoke for notes and folders) and `usersApi.search`.
- New i18n keys under a `notes.share.*` namespace added to **both**
  `apps/web/messages/de.json` and `apps/web/messages/en.json`.

## Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `ShareAccess` enum, `Share` model, `Folder.ownerId`, relations on `Note`/`Folder`/`User`; correct the `Tag` "all users see all notes" comment |
| `packages/db/prisma/migrations/<new>/migration.sql` | `Share` table, enum, indexes, XOR `CHECK`, `Folder.ownerId` + backfill + FK |
| `apps/web/src/lib/notes/access.ts` | **new** — resolution engine (`resolveNoteAccess`, `resolveFolderAccess`, `listAccessibleScope`, helpers) |
| `apps/web/src/lib/api/schemas.ts` | `shareCreateSchema`, `userSearchQuerySchema`, share/user types; `shareCount` on list item types |
| `apps/web/src/app/api/notes/route.ts` | list filtered; `POST` checks folder `EDIT` |
| `apps/web/src/app/api/notes/[id]/route.ts` | `VIEW`/`EDIT`/`OWNER` gates on GET/PATCH/DELETE |
| `apps/web/src/app/api/notes/[id]/body/route.ts` | `EDIT` gate |
| `apps/web/src/app/api/notes/[id]/history/route.ts` | `VIEW` gate |
| `apps/web/src/app/api/notes/[id]/assets/route.ts` | `EDIT`-on-note gate |
| `apps/web/src/app/api/assets/[id]/route.ts` | `VIEW`/`EDIT`-on-note gates |
| `apps/web/src/app/api/assets/[id]/preview/route.ts` | `VIEW`-on-note gate |
| `apps/web/src/app/api/folders/route.ts` | list filtered; `POST` checks parent `EDIT` |
| `apps/web/src/app/api/folders/[id]/route.ts` | `VIEW`/`EDIT`/`OWNER` gates |
| `apps/web/src/app/api/folders/reorder/route.ts` | `EDIT` gate on affected folders |
| `apps/web/src/app/api/collab/[noteId]/route.ts` | `VIEW` gate; token carries access level |
| `apps/web/src/app/api/search/route.ts` | inject access predicate into raw queries |
| `apps/web/src/app/api/notes/[id]/shares/route.ts` | **new** — list/create note shares |
| `apps/web/src/app/api/notes/[id]/shares/[shareId]/route.ts` | **new** — revoke note share |
| `apps/web/src/app/api/folders/[id]/shares/route.ts` | **new** — list/create folder shares |
| `apps/web/src/app/api/folders/[id]/shares/[shareId]/route.ts` | **new** — revoke folder share |
| `apps/web/src/app/api/users/route.ts` | **new** — grantee search |
| `apps/web/src/lib/notes/api-client.ts` | `sharesApi`, `usersApi.search` |
| `apps/web/src/components/notes/Share/*` | **new** — `ShareDialog`, `ExpiryPicker`, `useShares` |
| `apps/web/src/components/notes/Sidebar/*` | eye icon on note/folder rows |
| `apps/web/messages/{de,en}.json` | `notes.share.*` keys |
| `apps/worker/src/yjs/token.ts` | token payload gains `access` (`r`/`w`) |
| `apps/worker/src/index.ts` | read-only enforcement for `r` connections |
| `apps/web/src/lib/api/test-session.ts` | `makeTestFolder`, `makeTestNote`, `makeTestShare`; `cleanupNotesDomain` clears `Share` |
| `docs/adr/0026-explicit-resource-sharing.md` | **new** — the sharing-model ADR |
| `docs/adr/README.md` | ADR index gains a line |
| `vitest.config.ts` | coverage `include` additions for new files |

## Testing

Integration tests hit a real Postgres (per CLAUDE.md); the repo enforces a
≥ 90 % / ≥ 80 % coverage gate.

- **`access.ts`** — unit/integration: author → `OWNER`; ancestor-folder owner
  → `OWNER`; direct note share → its level; ancestor-folder share inherited;
  expired share → `null`; deepest of multiple grants wins; cycle-safe folder
  chain; `listAccessibleScope` returns owned + shared + descendants.
- **Every guarded route** — a second user (user B) is denied (`403`) on user
  A's private note/folder/asset; a `VIEW` share lets B `GET` but `403`s B's
  `PATCH`/`PUT`/`DELETE`; an `EDIT` share lets B mutate but `403`s a hard
  delete; a folder share lets B reach notes and sub-folders inside it.
- **List & search** — return only accessible notes/folders for the caller;
  a private note never appears in another user's list or search hits.
- **Share API** — owner and edit-grantee can create; re-share upserts;
  non-managers `403`; revoke rules (owner any / non-owner own-created only);
  `ttl` produces the right `expiresAt`; audit rows written.
- **User search** — matches by name/email, excludes the caller.
- **Collab** — `GET /api/collab/[noteId]` `403`s without access; issues a
  `w` token for editors and an `r` token for viewers; `token.ts` round-trips
  the `access` field; the worker rejects updates on an `r` connection.
- New coverage-gated files are added to `vitest.config.ts` `include`.

## Risks

- **Folder-owner backfill is irreversible.** Mitigated by an explicit
  sign-off gate and a deterministic rule; a fresh dev DB sidesteps it.
- **Trusting the client `assetIds` reconcile (D)** is unchanged — it is
  already `noteId`-scoped, so it inherits this ownership model for free once
  the body endpoint is gated.
- **No break-glass access.** A folderless note whose author is deactivated
  becomes unreachable. Bounded (folder-filed notes still have the folder
  owner); a future ADR may add recovery. Documented in ADR 0026.
- **Collab read-only complexity.** Enforcing `r` in the worker is the
  highest-risk task; it is sequenced last so the REST lock ships first even
  if read-only collab needs iteration.
- **`listAccessibleScope` loads all folders per list/search call.** Fine for
  a notes app's folder count; a recursive CTE is the documented escape hatch.
- **Folder-tree cycles** from a bad reparent are contained by the resolver's
  `visited`-set guard; a deep-cycle check on folder `PATCH` is a possible
  follow-up.

## Implementation phasing (for the plan)

1. Schema + migration + backfill.
2. `access.ts` engine + tests.
3. Enforcement in notes/assets/folders/search route handlers + tests.
4. Share-management + user-search API + tests.
5. Collab token access level + worker read-only enforcement.
6. UI — share dialog, expiry picker, eye icon, i18n.
7. ADR 0026, schema-comment correction, docs, coverage config.
