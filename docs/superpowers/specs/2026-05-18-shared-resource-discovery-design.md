# Shared-Resource Discovery

**Date:** 2026-05-18
**Status:** Draft — awaiting sign-off, then implementation plan
**Area:** `apps/web` notes sidebar (`Sidebar`, a new `SharedWithMe`,
`NotesShell`), the folders/notes list APIs, a new share-seen endpoint, the
`Share` schema.

## Context

Notes and folders are private by default; access is granted by explicit
`Share` rows (ADR 0026, `apps/web/src/lib/notes/access.ts`). `Share` records
`granteeId`, `access` (`VIEW`/`EDIT`), `expiresAt`, **`createdById`** (the
sharer) and `createdAt`.

`listAccessibleScope(userId)` already folds shared resources into the
recipient's world: `GET /api/folders` returns every folder the user owns or
has a folder-share on plus all descendants; `GET /api/notes` returns notes the
user authored, notes in an accessible folder, and directly-shared notes.

So the data already reaches the recipient — but nothing is *surfaced*:

- A folder shared with user B has a `parentId` pointing into the sharer's
  hierarchy, which B cannot see. `buildFolderTree` therefore renders it as an
  **unmarked root** in B's own folder tree, mixed in with B's folders.
- Directly-shared notes appear in B's notes list with no grouping.
- B gets no signal that something was shared, who shared it, or where to find
  it.

## Problem

A recipient cannot discover or distinguish resources shared with them, cannot
see who shared them, and has no signal when something new is shared. The
sharing feature is, from the recipient's side, effectively invisible.

## Goals

1. A dedicated **"Shared with me"** section surfaces every folder/note shared
   with the current user, separate from their own content.
2. Each shared resource is attributed to the person who shared it and shows
   the recipient's access level.
3. The recipient gets an **unseen indicator** — a count and per-item dots —
   so a newly-shared resource is noticed.
4. Shared folders stop polluting the recipient's own folder tree as unmarked
   roots (today's bug).

## Decisions (resolved during brainstorming)

- **A dedicated "Shared with me" section** in the sidebar — not an inline
  badge in the existing tree, not a separate hidden view.
- **Tag the existing list endpoints.** `GET /api/folders` and `GET /api/notes`
  gain an optional `sharedWithMe` block on each node, populated only on the
  directly-shared root. No new "list shared" endpoint; the client splits
  owned vs shared by that block's presence. (Considered and rejected: a
  dedicated `/api/shared` endpoint — it would need a second data path for
  browsing into a shared folder's subtree.)
- **`Share.seenAt DateTime?`** — `null` = the grantee has not yet opened that
  shared resource.
- **Unseen indicator** — the section heading shows the count of shares with
  `seenAt === null`; each unopened shared root shows a dot. Opening the
  resource clears it. (Considered and rejected: a full notification feed —
  a whole subsystem; too much for this.)
- **A grantee-side `POST /api/shares/[id]/seen`** marks a share seen
  (idempotent).
- **Browse-and-open only.** The "Shared with me" tree supports navigation and
  opening; it offers no rename / delete / move / icon-change / new-note on
  shared folders. Editing a *note's content* in a shared folder still works
  (the editor, gated by the recipient's access). Structural edits to shared
  folders stay the owner's domain.
- **No ADR** — ADR 0026 already covers the sharing model; this is additive
  recipient-side surfacing (one column, UI, no architectural change).

## Non-goals

- Structural edits to shared folders from the "Shared with me" section
  (rename / delete / move / new-note / icon).
- A notification feed / notification centre.
- Pre-disabling the editor for a `VIEW`-only recipient — an existing
  limitation (the editor does not expose the resolved access level to the
  client). The access badge informs the recipient; the server still enforces.
- Out-of-app notification (email, push) — the indicator is in-app only.
- Any change to re-sharing, the access model, or share *management*
  (the owner-side share dialog and endpoints are untouched).
- Responsive layout — tracked as a separate feature.

## Design

### 1. Schema & migration

`packages/db/prisma/schema.prisma` — the `Share` model gains:

```prisma
seenAt DateTime?
```

`null` means the grantee has not opened the shared resource. The migration is
additive (a nullable column; existing shares backfill to `null` = unseen,
which is the correct default for shares that predate the feature).

### 2. `access.ts` — direct-share metadata

`listAccessibleScope(userId)` already loads the folder table and the user's
folder/note shares. Extend it (or add a sibling) so its result also carries a
**`directShares`** map — keyed by the directly-shared folder/note id, valued
with `{ kind: 'folder' | 'note', shareId, sharedByName, access, seenAt }`.

This requires the share queries to select `id`, `access`, `seenAt`,
`expiresAt`, and `createdBy { displayName, email }`. `sharedByName` resolves
to `displayName`, falling back to `email`, falling back to a generic label.
The accessible-id computation is unchanged; `directShares` is additive, so
existing callers (search, the notes list) ignore it.

### 3. API tagging — `sharedWithMe` on list nodes

`apps/web/src/lib/api/schemas.ts`: `FolderNode` and `NoteListItem` each gain an
optional field:

```ts
sharedWithMe?: {
  shareId: string;
  sharedByName: string;
  access: 'VIEW' | 'EDIT';
  seenAt: string | null;   // ISO timestamp, or null when unseen
};
```

`GET /api/folders` and `GET /api/notes` look each resource up in
`directShares` and attach `sharedWithMe` **only on the directly-shared root** —
never on a folder/note the user owns, and never on a descendant of a shared
folder (a descendant is reached *via* the parent share, not shared directly).

This is the recipient-side split signal: a root folder or note carrying
`sharedWithMe` belongs in "Shared with me"; without it, it is the user's own.
It also fixes the orphaned-root bug — the client no longer shows a shared
folder among the user's own roots.

### 4. `POST /api/shares/[id]/seen`

A new route `apps/web/src/app/api/shares/[id]/seen/route.ts`. The caller must
be the share's `granteeId` (else 404 — do not reveal the share exists). It
sets `seenAt = now()` when currently `null`; if already set it is a no-op.
Either way it returns 200. Idempotent and safe to call on every open.

### 5. The "Shared with me" sidebar section

**`NotesShell`** already fetches the folder and note lists. With the tagging,
it partitions the folder list: a folder is a **shared root** when it carries
`sharedWithMe`; a folder is part of the shared world when it is a shared root
*or* a descendant of one (walk `parentId`); everything else is the user's own.
The directly-shared notes are the note-list items carrying `sharedWithMe`.
A shared root that is itself a descendant of another shared root nests under
that parent — it is not listed twice.

**`SharedWithMe`** — a new component in `apps/web/src/components/notes/Sidebar/`,
rendered in the sidebar's left (folders) pane *below* the user's own
"My folders" tree. It renders **only** when the user has at least one shared
resource.

- A heading **"Shared with me"** with a badge: the count of the user's shares
  with `seenAt === null`.
- **Shared folders** — a read-only navigable tree of the shared roots and
  their descendants: no rename / delete / move / DnD. Each **shared root** row
  carries extra chrome — *"shared by <name>"*, an access badge (View / Can
  edit), and an unseen dot when `seenAt` is `null` — while descendant rows are
  plain folder rows. Selecting any folder loads its notes in the right-hand
  notes pane through the existing folder-selection path. (Whether the
  descendant navigation reuses the existing `FolderTree` in a no-mutations
  mode or is a focused component is an implementation choice for the plan.)
- **Directly-shared notes** — note rows in the section, each with attribution,
  access badge and unseen dot. Clicking one opens it in the editor.

**Seen tracking.** When the recipient first opens a shared resource — selects
a shared folder, or opens a shared note — and that resource's `sharedWithMe.
seenAt` is `null`, the client calls `sharesApi.markSeen(shareId)` and
optimistically clears the dot (dropping the heading count). `sharesApi.markSeen`
is a new method in `api-client.ts` calling the Step-4 endpoint.

### 6. i18n

A new `notes.sharedWithMe` namespace in both `apps/web/messages/de.json` and
`en.json`, identical keys: `heading` ("Shared with me"), `sharedBy` (with a
`{name}` placeholder), `accessView`, `accessEdit`, and an `unseenLabel` for the
badge's accessible name.

## Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `Share.seenAt DateTime?` |
| `packages/db/prisma/migrations/<ts>_share_seen_at/` | **new** — additive column |
| `apps/web/src/lib/notes/access.ts` | `listAccessibleScope` also returns `directShares` |
| `apps/web/src/lib/api/schemas.ts` | `sharedWithMe` on `FolderNode` + `NoteListItem` |
| `apps/web/src/app/api/folders/route.ts` | attach `sharedWithMe` in the GET serializer |
| `apps/web/src/app/api/notes/route.ts` | attach `sharedWithMe` in the GET serializer |
| `apps/web/src/app/api/shares/[id]/seen/route.ts` | **new** — `POST` mark-seen |
| `apps/web/src/lib/notes/api-client.ts` | `sharesApi.markSeen(id)` |
| `apps/web/src/components/notes/Sidebar/SharedWithMe.tsx` (+ test) | **new** — the section |
| `apps/web/src/components/notes/Sidebar/index.tsx` | render `<SharedWithMe>` in the left pane |
| `apps/web/src/components/notes/NotesShell.tsx` | partition owned/shared; mark-seen on open |
| `apps/web/messages/{de,en}.json` | `notes.sharedWithMe` keys |
| `vitest.config.ts` | coverage `include` for the new files |

## Testing

- **`access.ts`** — `listAccessibleScope` returns `directShares` entries for
  directly-shared folders/notes (with sharer name, access, `seenAt`) and not
  for owned resources or descendants of a shared folder.
- **`GET /api/folders` / `GET /api/notes`** — integration (real Postgres):
  `sharedWithMe` is present on a directly-shared root, absent on an owned
  resource and on a descendant of a shared folder; `sharedByName` falls back
  when `displayName` is null.
- **`POST /api/shares/[id]/seen`** — sets `seenAt`; idempotent (a second call
  is a no-op, still 200); a non-grantee gets 404; an unknown id gets 404.
- **`SharedWithMe`** — component tests: renders shared folders + notes with
  attribution and access badge; shows the unseen count and per-item dots; is
  absent when there are no shares; opening an item clears its dot.
- **Migration** — the additive column; existing share tests stay green.

## Risks

- **A revoked or expired share** — `listAccessibleScope` already filters it, so
  the resource drops off the next fetch and out of "Shared with me." If the
  recipient had it open, existing access enforcement applies (a save 403s) —
  unchanged.
- **`sharedWithMe` widens the list payloads.** Minor — one small optional
  object on shared roots only; most nodes carry nothing.
- **A stale optimistic "seen".** If `markSeen` fails after the dot is cleared
  optimistically, the dot reappears on the next fetch (`seenAt` still null) —
  self-healing; acceptable.
- **`FolderNode.sharedWithMe` required vs optional.** It is optional, so the
  many existing `FolderNode` fixtures need no change — only tests exercising
  the shared path add it.
