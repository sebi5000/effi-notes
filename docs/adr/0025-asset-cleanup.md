# ADR 0025 — Asset cleanup via client-reported references + grace-period sweep

**Status:** Accepted
**Date:** 2026-05-16

## Context

Removing an image or PDF from a note's editor orphans its `Asset` row
(Postgres `bytea` bytes + preview); only deleting the whole note cascades.
Orphaned blobs accumulate and bloat the database. Determining "which assets
does a note still reference" requires inspecting the note's editor document.

## Decision

Mark-and-sweep with a 24-hour grace period:

- A nullable `Asset.unreferencedSince` column marks when an asset stopped
  being referenced.
- The editor client reports the asset IDs its document references with each
  note-body save; `PUT /api/notes/[id]/body` reconciles `unreferencedSince`
  for that note (stamp newly-unreferenced assets, un-stamp re-referenced
  ones), scoped to the saved note.
- A periodic worker job (`assets.sweep`, hourly) hard-deletes assets whose
  `unreferencedSince` is older than 24 hours.

The reconcile is client-reported — not done in the worker — because ADR 0022
deliberately keeps the editor's ProseMirror schema out of the worker (its
snapshot job treats the Yjs document as opaque CRDT bytes). Having the worker
walk the document for asset node types would breach that split. The web app
already owns the editor schema and enumerates a note's assets (for the
document panel), so it is the natural place for the mark. The sweep stays in
the worker because it is pure timestamp logic with no schema knowledge.

## Consequences

- The worker remains schema-agnostic — ADR 0022 is preserved.
- The 24-hour grace makes undo, cut-and-paste, and upload races safe — a
  re-referenced asset is un-stamped before the sweep would reach it.
- The reconcile trusts the client's asset-ID list. Scoped by `noteId`, the
  blast radius is the user's own note's assets only — the same trust already
  placed in the note body the client sends.
- The mark is edit-triggered: an orphan in a note that is never edited again
  is never swept. Accepted — a server-side full scan would need the
  worker-side document walk ADR 0022 forbids.
- Cross-note asset reuse remains unsupported (a pre-existing non-goal):
  each asset is reconciled against its own note only.

## References

- Spec: `docs/superpowers/specs/2026-05-16-asset-cleanup-design.md`
- ADR 0022 — yjs / y-websocket in the worker
- ADR 0023 — asset storage in Postgres
