# Asset Cleanup (Sub-project D)

**Date:** 2026-05-16
**Status:** Approved — ready for implementation plan
**Area:** `packages/db` schema, `apps/web` note API + editor, `packages/jobs`, `apps/worker`

## Context

This is **sub-project D**, following A → B → C:
- **A — Asset storage + Images** (done): the `Asset` model + image upload.
- **B — PDF insert** (done): PDFs, the `pdf.extract` worker job.
- **C — Document panel** (done): the right-side outline / image / PDF / link
  panel.
- **D — Asset cleanup** (this spec): delete an `Asset` row when its image or
  PDF is removed from the note's editor content.

A's spec wrongly claimed "deleting a note deletes its assets, so there is no
orphan-cleanup problem" — that covers *note* deletion only. Removing an
image/PDF *node* from a surviving note orphans its `Asset` row (Postgres
`bytea` bytes + preview) forever. D closes that gap.

## Problem

When a user removes an image or PDF from a note, the underlying `Asset` row
is never freed — only deleting the whole note cascades
(`Asset.note onDelete: Cascade`). Over time, orphaned blobs accumulate and
bloat the application database.

## Goals

1. When an image or PDF is removed from a note's editor content — and the
   removal sticks — its `Asset` row (bytes + preview) is deleted, reclaiming
   database space.
2. The deletion is **safe**: an asset only briefly unreferenced — mid
   cut-and-paste, about to be undone, or freshly uploaded but not yet saved —
   is never destroyed.

## Decisions (resolved during brainstorming)

- **Strategy: mark-and-sweep with a grace period.** An asset that the
  document no longer references is *marked* with an "unreferenced since"
  timestamp; a periodic *sweep* deletes assets that have stayed marked past a
  grace period. A re-referenced asset is un-marked — so undo, cut-and-paste,
  and upload races are all safe.
- **Grace period: 24 hours.** An asset removed from a note is deleted a day
  later — comfortably past undo / cut-paste / upload races, and long enough
  for a person to notice an accidental removal.
- **The "mark" is client-reported on note save.** The editor already
  enumerates a note's image/PDF assets (for the document panel). It sends
  that asset-ID list with the existing note-body save; the web API
  reconciles `Asset.unreferencedSince`. The **worker is not involved in the
  mark** — ADR 0022 deliberately keeps the editor's ProseMirror schema out of
  the worker (the snapshot job treats the Yjs document as opaque CRDT bytes),
  and this design preserves that. The trust placed in the client's asset-ID
  list is the same trust already placed in the note body the client sends —
  it only ever affects the user's own note's assets.
- **The sweep is a worker job.** It is pure timestamp logic — a
  `deleteMany` by `unreferencedSince` — with no editor-schema knowledge, so
  it lives in the worker without breaching ADR 0022.
- **Hard delete.** The sweep hard-deletes the `Asset` row (bytes + preview
  gone). Reclaiming space is the whole point; the 24-hour grace is the
  safety net.
- This design gets an **ADR** (`docs/adr/0025-asset-cleanup.md`) — it records
  the client-reported-reconcile choice and its relationship to ADR 0022.

## Non-goals

- Cross-note asset reuse tracking. A's spec already declared this a non-goal:
  an `Asset` is linked to the single note it was uploaded into. D reconciles
  each asset against **its own note only**. Copying an asset node into another
  note does not re-link it; removing it from the original note will sweep it
  and break the copy. D does not change this pre-existing v1 limitation.
- Cleaning assets in a note that is **never edited again**. The mark is
  edit-triggered (it rides the note-body save). An orphan in a note that is
  never re-edited stays un-marked and is never swept — it is freed only if
  that note is edited or deleted. Accepted: a server-side full scan would
  require walking every note's document, which the ADR-0022 split keeps out
  of the worker.
- A UI for managing or restoring assets. D is silent background cleanup; no
  user-facing strings.
- OCR, the document panel, or any A/B/C feature.

## Design

### 1. Data model — `Asset.unreferencedSince`

A new nullable column on the existing `Asset` model
(`packages/db/prisma/schema.prisma`):

- `unreferencedSince` — `DateTime?`. `null` means the asset is referenced /
  in use. A timestamp means the document stopped referencing it at that
  moment — the start of its grace clock.
- `@@index([unreferencedSince])` — so the sweep's
  `deleteMany({ where: { unreferencedSince: { lt: … } } })` is a fast index
  scan.

The migration is plain-additive (one nullable column, one index) —
zero-downtime. Existing rows default to `null` (referenced); they are marked,
if orphaned, the next time their note is edited.

### 2. The "mark" — reconcile on note-body save

**Client side.** The editor's note-body save (`CollaborativeEditor` in
`NoteEditor.tsx` → `notesApi.putBody`) currently sends `{ body, baseUpdatedAt }`.
It additionally sends `assetIds: string[]` — the asset IDs the current
document references. A pure helper `referencedAssetIds(doc)` (added to
`doc-outline.ts`, which already walks the document) returns them: the id from
each `image` node's `/api/assets/<id>` src, and each `pdfChip` node's
`assetId` attribute.

**Server side.** `PUT /api/notes/[id]/body` — the request body schema
(`apps/web/src/lib/api/schemas.ts`) gains `assetIds: string[]` (Zod-validated).
After the note update succeeds (and only then — a `409` conflict skips the
reconcile), the route reconciles that note's assets with two scoped
`updateMany` calls:

- **un-mark referenced assets:**
  `updateMany({ where: { noteId, id: { in: assetIds }, unreferencedSince: { not: null } }, data: { unreferencedSince: null } })`
- **mark newly-unreferenced assets:**
  `updateMany({ where: { noteId, id: { notIn: assetIds }, unreferencedSince: null }, data: { unreferencedSince: <now> } })`

Both are scoped by `noteId`, so the client's `assetIds` can only ever affect
*this note's* assets. An already-marked unreferenced asset keeps its original
timestamp (the second query's `unreferencedSince: null` filter excludes it).

### 3. The "sweep" — periodic deletion job

A new BullMQ queue `assets.sweep` (`packages/jobs/src/queues.ts`), run as a
**repeatable** job scheduled in the worker entry (`apps/worker/src/index.ts`),
following CLAUDE.md's "cron / repeatable jobs go in the worker entry" rule —
hourly.

The processor (`apps/worker/src/processors/assets-sweep.ts`), wrapped in
`withSpan`:

- `prisma.asset.deleteMany({ where: { unreferencedSince: { lt: new Date(Date.now() - GRACE_MS) } } })`
  where `GRACE_MS` is 24 hours.
- Logs the swept count via `createLogger`; records one summary audit-log
  entry (`assets.swept`, count in metadata) — a system-initiated action,
  consistent with the other mutating paths.
- No editor-schema knowledge — pure timestamp logic.

An asset is therefore deleted within roughly 24–25 hours of becoming
unreferenced (24h grace + up to 1h until the next sweep).

### 4. Safety — edge cases

- **Undo** — remove image → next save marks it → user undoes → image back →
  next save un-marks it. Safe (well within 24h).
- **Cut-and-paste within a note** — transient; the save after the paste sees
  the asset referenced again → un-marked.
- **Upload race** — a freshly-uploaded `Asset` row defaults to
  `unreferencedSince = null`. If a save fires before the node is in the
  document, the asset is marked; the next save (with the node) un-marks it —
  all within 24h. Safe.
- **Collaborative editing** — each client's save reports that client's view;
  any save that sees the asset referenced un-marks it. Brief mark/un-mark
  flip-flopping between laggy clients is harmless given the 24h grace.
- **Note / folder deletion** — still cascades via the FK; untouched.

## Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `Asset.unreferencedSince` + `@@index` |
| `packages/db/prisma/migrations/<new>/migration.sql` | additive — one nullable column + index |
| `apps/web/src/lib/notes/doc-outline.ts` | **add** `referencedAssetIds(doc)` helper |
| `apps/web/src/lib/api/schemas.ts` | note-body-save schema gains `assetIds` |
| `apps/web/src/app/api/notes/[id]/body/route.ts` | reconcile `Asset.unreferencedSince` on a successful save |
| `apps/web/src/lib/notes/api-client.ts` | `notesApi.putBody` sends `assetIds` |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | the save computes + passes `assetIds` |
| `packages/jobs/src/queues.ts` | `assets.sweep` queue + repeatable scheduling helper |
| `packages/jobs/src/index.ts` | re-export the new symbols |
| `apps/worker/src/processors/assets-sweep.ts` | **new** — the sweep processor |
| `apps/worker/src/index.ts` | register the `assets.sweep` Worker + schedule the hourly repeatable |
| `docs/adr/0025-asset-cleanup.md` | **new** — the cleanup-strategy ADR |
| `docs/adr/README.md` | ADR index gains a line |
| `vitest.config.ts` | coverage `include` additions |

## Testing

The repo enforces a ≥ 90 % / ≥ 80 % coverage gate.

- **`referencedAssetIds`** — unit tests with a headless editor: a document
  with image + `pdfChip` nodes yields the correct flat ID list (image id
  parsed from `src`, pdf id from `assetId`); an empty document yields `[]`.
- **Body-save reconcile** — integration tests against a real Postgres: a
  save whose `assetIds` omits an asset marks it (`unreferencedSince` set); a
  later save that includes it again un-marks it; an asset already marked
  keeps its original timestamp; a `409` conflict performs no reconcile; the
  `assetIds` only affect the saved note's assets.
- **Zod schema** — the `assetIds` field validation.
- **`assets.sweep` processor** — integration: assets with
  `unreferencedSince` older than 24h are deleted; assets marked recently and
  unmarked assets are kept; an audit entry is written.
- **`assets.sweep` producer / repeatable scheduling** — unit test of the
  queue helper.
- New coverage-gated files are added to the `vitest.config.ts` `include`
  list and tested to threshold.

## Risks

- **Trusting the client's `assetIds`.** A buggy or malicious client could
  report a wrong list. Scoped by `noteId`, the blast radius is the user's own
  note's assets only: reporting too few marks in-use assets (they would be
  swept after 24h — a self-inflicted loss on one's own note); reporting too
  many delays cleanup. The next correct save self-heals the marks. Accepted —
  the same trust model as the note body itself.
- **Edit-triggered mark.** Orphans in a note that is never edited again are
  never marked, so never swept. Accepted (see Non-goals) — bounded, and the
  alternative needs the worker-side document walk that ADR 0022 forbids.
- **Reconcile cost on save.** Two scoped `updateMany` calls per body-save —
  small and indexed; negligible next to the existing note update.
- **Sweep and an open session.** An asset marked >24h ago is deleted even if
  some client still shows it; that client's `<img>` then 404s. In practice an
  asset stays marked for 24h only if no save in that window re-referenced it,
  i.e. it genuinely is not in the document. Acceptable.
