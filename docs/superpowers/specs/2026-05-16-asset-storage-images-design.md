# Asset Storage & Images (Sub-project A)

**Date:** 2026-05-16
**Status:** Approved — ready for implementation plan
**Area:** `apps/web` notes editor, `apps/web` API, `packages/db` schema

## Context

This is **sub-project A** of a three-part feature (A → B → C):
- **A — Asset storage + Images** (this spec): the asset-storage foundation plus
  drag-and-drop / copy-and-paste images, resizable and editor-bounded.
- **B — PDF insert** (later): reuses A's storage; adds a PDF block with a
  first-page preview and async PDF text extraction.
- **C — Document panel** (later): a right-side panel — heading outline,
  image/PDF/link lists.

The editor (Tiptap 3, Yjs-collaborative) currently has **no asset support** —
no `Asset` model, no upload API, no file-serving route. Uploads were
explicitly deferred (`EditorToolbar.tsx`, `MarkdownExtensions.ts` comments).

## Problem

Users cannot put images into notes. They want to drag-and-drop or paste an
image, resize it (aspect ratio kept, never exceeding the editor width), and
have the image discoverable through the existing search.

## Goals

1. A reusable asset-storage foundation: an `Asset` data model, an upload API,
   and a file-serving route — designed so sub-project B (PDFs) reuses it.
2. Insert images by **drag-and-drop** and **copy-and-paste** into the editor.
3. Images are **resizable** — aspect ratio locked, clamped so they never
   exceed the editor's content width.
4. Images are **searchable**: a note appears in search results when an
   embedded image matches by **filename or caption**.

## Decisions (resolved during brainstorming)

- **Storage backend: PostgreSQL.** Asset bytes live in a `bytea` column on a
  new `Asset` table. Rationale: no new infrastructure or volume; assets are
  included automatically in the existing `pg_dump` backup; the searchable
  extracted text sits natively in the same `tsvector` search infrastructure;
  transactional consistency with note data. The rejected alternative
  (filesystem volume) would split bytes from search text, require extending
  the backup script, and complicate horizontal scaling. This decision gets
  an **ADR** (`docs/adr/`).
- **Image search level: filename + caption.** OCR of image *content* is a
  separate, larger sub-project (deferred). A still builds the full search
  plumbing so PDFs (B) and OCR (later) only need to feed text in.
- **No async worker job in A.** Filename and caption are known synchronously,
  so A sets the searchable columns directly at upload / caption-edit time.
  The async extraction job is introduced in B for PDF text.
- **Image size limit: 10 MB.** Accepted formats: `png`, `jpeg`, `gif`,
  `webp`. **SVG is excluded** (inline-SVG XSS risk).

## Non-goals

- PDF insert and PDF preview — sub-project B.
- OCR of image content — its own sub-project after C.
- The right-side document panel — sub-project C.
- An async extraction worker job — introduced in B.
- Cross-note asset reuse tracking. An `Asset` is linked to the note it was
  uploaded into; copy-pasting an image's node into another note does not
  re-link the asset. Accepted v1 limitation.

## Design

### 1. Data model — the `Asset` table

New Prisma model in `packages/db/prisma/schema.prisma`:

- `id` — cuid.
- `noteId` — FK → `Note`, `onDelete: Cascade`. Deleting a note deletes its
  assets, so there is no orphan-cleanup problem.
- `authorId` — FK → `User` (the uploader; audit actor).
- `kind` — enum `AssetKind { IMAGE, PDF }`. Only `IMAGE` is produced in A;
  `PDF` is declared now so B needs no enum migration.
- `contentType` — the validated MIME type.
- `filename` — the original filename.
- `caption` — user-editable caption, default `''`.
- `extractedText` — searchable text from the file body, default `''`.
  Unused for images in A; PDFs (B) and OCR (later) populate it.
- `byteSize` — integer.
- `data` — `Bytes` (Postgres `bytea`), the raw file.
- `createdAt` — timestamp.
- `searchVector` — a generated `tsvector` column over `filename` + `caption`
  + `extractedText`, added via raw SQL in the migration (Prisma sees it as
  `Unsupported`, exactly like `Note.searchVector`), with a GIN index.

`Note` gains an `assets Asset[]` relation. The migration is plain-additive
(new table, new enum) — zero-downtime.

### 2. Upload API — `POST /api/notes/[noteId]/assets`

- Auth-gated (`requireSession`).
- The note must exist (clean 404 otherwise).
- Body: the raw file bytes. The filename arrives as a query parameter
  (`?filename=`); the declared MIME as the `Content-Type` header.
- Validation: the declared type is one of the four accepted image types;
  the body's **magic bytes** confirm it (do not trust the client type);
  `byteSize ≤ 10 MB`. Zod guards the query params.
- Creates the `Asset` row (`kind: IMAGE`, `extractedText` left empty,
  `caption` empty, `filename` from the query).
- Writes an audit-log entry (`assets.uploaded`), consistent with the other
  mutating routes.
- Responds `201` with `{ id, url }` where `url = /api/assets/<id>`.

### 3. Serve API — `GET /api/assets/[id]`

- Auth-gated. Returns the `data` bytes with `Content-Type` from the row,
  `Content-Disposition: inline`, and `Cache-Control: private, max-age=...`
  (asset bytes are immutable for a given id). `404` for an unknown id.

### 4. Caption API — `PATCH /api/assets/[id]`

- Auth-gated. Body `{ caption: string }` (Zod-validated, length-capped).
- Updates `Asset.caption`; the generated `searchVector` regenerates.
- Used by the editor when the user edits an image's caption.

### 5. Editor — inserting images

- Add `@tiptap/extension-image` and `@tiptap/extension-file-handler` to the
  editor's extension list (`MarkdownExtensions.ts`).
- `FileHandler` intercepts **drop** and **paste** of image files. On a
  dropped/pasted image: upload it to `POST /api/notes/[noteId]/assets`, then
  insert an image node with `src = /api/assets/<id>` at the drop/cursor
  position. Non-image files are ignored in A (PDFs handled in B).
- `NoteEditor` passes its `noteId` into the upload callback.
- Upload failures surface a non-blocking error (the editor stays usable).

### 6. Resizable, bounded image — a NodeView

The `Image` extension is configured with extra attributes — `width` (a pixel
number) and `caption` (string) — and a custom React `NodeView`:

- Renders `<figure>`: the `<img>` plus an editable caption line beneath it
  (placeholder when empty).
- The `<img>` is styled `width: <width>px; height: auto; max-width: 100%`.
  `height: auto` keeps the aspect ratio; `max-width: 100%` of the editor
  content column is the **hard bound** — the image can never exceed the
  editor regardless of the stored `width`.
- A corner drag-handle resizes: dragging sets `width`, clamped to
  `[minWidth, contentColumnWidth]`. `width` is committed to the node
  attribute on pointer-up (not per-move) to limit Yjs traffic.
- Editing the caption updates the `caption` node attribute and triggers a
  debounced `PATCH /api/assets/<id>` so `Asset.caption` (and the search
  index) stays in sync. The node attribute is the display source of truth;
  `Asset.caption` is its search mirror.
- `width` and `caption` are node attributes, so they round-trip through the
  Yjs document like any other editor content.

### 7. Search integration — `/api/search`

`/api/search` is extended: in addition to matching `Note.searchVector`, it
also matches `Asset.searchVector`; for a matching asset it surfaces the
asset's owning `Note` (join via `noteId`) as a `SearchHit`. Results are
de-duplicated by note id (a note matching both directly and via an asset
appears once). A note therefore appears in search when an embedded image
matches by filename or caption.

### 8. Markdown export

The existing "Copy as Markdown" button (`htmlToMarkdown` / Turndown)
converts an `<img>` to `![caption](src)` via Turndown's built-in rule — no
new rule required. Confirmed by a test.

## Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `Asset` model, `AssetKind` enum, `Note.assets` relation |
| `packages/db/prisma/migrations/<new>/migration.sql` | create table + enum + generated `searchVector` + GIN index |
| `apps/web/src/lib/api/schemas.ts` | Zod schemas for asset upload + caption patch |
| `apps/web/src/app/api/notes/[noteId]/assets/route.ts` | **new** — `POST` upload |
| `apps/web/src/app/api/assets/[id]/route.ts` | **new** — `GET` serve, `PATCH` caption |
| `apps/web/src/app/api/search/route.ts` | extend to match assets → owning note |
| `apps/web/src/lib/notes/api-client.ts` | typed `assetsApi` (upload, patch) |
| `apps/web/src/components/notes/Editor/ImageExtension.ts` | **new** — `Image` configured with `width`/`caption` + NodeView |
| `apps/web/src/components/notes/Editor/ResizableImage.tsx` | **new** — the NodeView component |
| `apps/web/src/components/notes/Editor/MarkdownExtensions.ts` | register `Image` + `FileHandler` |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | wire the FileHandler upload callback (passes `noteId`) |
| `apps/web/src/app/globals.css` | image + caption styling |
| `apps/web/messages/en.json`, `de.json` | caption placeholder, upload-error string |
| `apps/web/package.json` | `@tiptap/extension-image`, `@tiptap/extension-file-handler` |
| `docs/adr/<next>-asset-storage-in-postgres.md` | **new** — the storage-backend ADR |
| `vitest.config.ts` | coverage `include` additions (`api/assets/**`, new editor files) |

## Testing

The repo enforces a ≥90 % / ≥80 % coverage gate.

- **Upload / serve / patch routes** — integration tests against a real
  Postgres (per CLAUDE.md): a valid image uploads and is retrievable; a
  non-image / oversized / magic-byte-mismatched body is rejected; `PATCH`
  updates the caption; serving an unknown id is `404`; unauthenticated
  requests are `401`.
- **Zod schemas** — unit tests for the upload/patch validation.
- **Search extension** — an integration test: a note becomes findable via an
  embedded asset's filename / caption, with correct de-duplication.
- **Image extension + NodeView** — `ImageExtension` unit-tested with a
  headless editor (attributes, `width`/`caption` round-trip);
  `ResizableImage` as a component test (renders, the resize handle clamps to
  the content width, the caption edit fires the patch callback).
- **Markdown export** — a test confirming `<img>` → `![caption](url)`.
- New coverage-gated files are added to the `vitest.config.ts` `include`
  list and tested to threshold.

## Risks

- **DB size from blobs.** `bytea` assets grow the application database. For a
  single-tenant notes app with the 10 MB image cap this is acceptable; the
  ADR records it, and a customer with heavy asset volumes can revisit the
  backend later behind the same `Asset` interface.
- **Upload during collaborative editing.** The upload is an out-of-band REST
  call; only the resulting image node (with its `src`) enters the Yjs doc, so
  collaboration is unaffected — consistent with how callouts and other nodes
  already work.
- **`getText()` and the note `body`.** Image nodes contribute nothing to
  `editor.getText()`, so images persist via the Yjs snapshot, not the `body`
  index — the existing editor architecture, unchanged here.
- **Tiptap dependency versions.** `@tiptap/extension-image` and
  `@tiptap/extension-file-handler` must be pinned to the repo's Tiptap
  version (3.23.x) — verified against `npm view` in the plan.
