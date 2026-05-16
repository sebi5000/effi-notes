# ADR 0026 — Explicit per-resource sharing model (notes & folders)

**Status:** Accepted
**Date:** 2026-05-17

## Context

Notes and folders were authenticated but not authorised: any logged-in user could
read, edit, archive, or delete any note or folder by id. The v1 assumption recorded
in `schema.prisma` — "all users see all notes" — was a placeholder, not a product
decision. Brainstorming in sub-project E widened both the gap (the assets, collab,
and search endpoints were equally unguarded) and the solution: private-by-default
sharing as a first-class product feature.

The `Folder` model carried no owner column, making it impossible to designate who
may grant access to a folder's contents. ADR 0022 (real-time collaboration) issued
y-websocket tokens to any authenticated user for any note, creating a bypass path
that had to be closed alongside the REST API.

## Decision

**Private by default.** A note or folder is accessible only to its owner and to
users granted access through an explicit `Share` record. Unauthenticated requests
are rejected at middleware (unchanged); authenticated requests to a resource the
caller cannot reach return `403`.

**Schema.** One `Share` table with two nullable foreign keys (`noteId`, `folderId`)
and a DB `CHECK` constraint enforcing exactly one is set. Columns: `granteeId`,
`access` (enum `VIEW | EDIT`), optional `expiresAt`, `createdById`, `createdAt`.
`Folder` gains `ownerId`. The old "all users see all notes" schema comment is
removed. The `Folder.ownerId` backfill was a one-time data step in the migration.

**Cascade.** Owning a folder confers `OWNER` access to every sub-folder and note
within it. A folder share cascades downward identically — a `VIEW` grant on a
folder makes every note and sub-folder inside it viewable. A note with no folder
is private to its author alone.

**No role bypass.** `admin` / `ops` roles carry no implicit access — they are
bound by ownership and explicit shares like any other user. Break-glass admin
access is a documented non-goal.

**Share management.** Owner and `EDIT`-grantees may create shares. An owner may
revoke any share; a non-owner manager may revoke only shares they created
(`Share.createdById`). Cannot share a resource with its own owner.

**HTTP semantics.** An unauthorised request to an existing resource returns `403`.
A genuinely missing id returns `404`. (The id-existence leak is accepted in
exchange for honest, debuggable responses.)

**Lazy expiry.** An expired share stops granting access
(`expiresAt IS NULL OR expiresAt > now()` applied at every query). No sweep job —
expired rows are harmless and remain visible in the share dialog.

**Single resolution engine.** `apps/web/src/lib/notes/access.ts` is the only place
authorisation rules live. It exposes `resolveNoteAccess`, `resolveFolderAccess`,
`listAccessibleScope` (for list and search filtering), and helpers `atLeast`,
`canEdit`, `canManageShares`, `canHardDelete`. Every guarded route handler calls
into this module; no handler duplicates access logic inline.

## Relationship to ADR 0022

ADR 0022 issues HMAC-signed y-websocket tokens and keeps the editor's ProseMirror
schema out of the worker. That contract is preserved; only the token payload changes.
The token now carries an access claim (`r` for VIEW, `w` for EDIT/OWNER`). The
worker reads this claim and drops inbound document updates for `r` connections,
enforcing read-only collaboration for view-only grantees. The collab endpoint
(`GET /api/collab/[noteId]`) resolves note access before issuing the token; no
access returns `403`.

## Consequences

- All notes, assets, folders, collab-token, and search endpoints enforce ownership
  or share grants. The blast radius of a misconfigured route is bounded to the
  caller's own accessible set.
- Folder-scoped shares eliminate the need to share every note individually; the
  cascade is computed in app code (iterative walk with a cycle guard + depth cap
  of 64). A recursive SQL CTE is the documented escape hatch if folder depth
  becomes a performance concern.
- `listAccessibleScope` loads all folders per list/search call. Fine for a notes
  app; accepted as is.
- Accepted risk: a folderless note whose author is deactivated and which was never
  shared becomes inaccessible. Bounded (folder-filed notes still have the folder
  owner). Break-glass admin access is a non-goal; a future ADR may add a recovery
  path.

## References

- Spec: `docs/superpowers/specs/2026-05-16-resource-sharing-design.md`
- ADR 0022 — Yjs / y-websocket in the worker (collab token contract)
- ADR 0025 — Asset cleanup via client-reported references + grace-period sweep
