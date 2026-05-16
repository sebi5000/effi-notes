# PDF Insert (Sub-project B)

**Date:** 2026-05-16
**Status:** Approved — ready for implementation plan
**Area:** `apps/web` notes editor, `apps/web` API, `apps/worker`, `packages/jobs`, `packages/db` schema

## Context

This is **sub-project B** of a three-part feature (A → B → C):
- **A — Asset storage + Images** (done): the asset-storage foundation plus
  drag-and-drop / copy-and-paste images, resizable and editor-bounded.
- **B — PDF insert** (this spec): reuses A's storage; adds a PDF file chip,
  a first-page preview rendered server-side, and async PDF text extraction.
- **C — Document panel** (later): a right-side panel — heading outline,
  image/PDF/link lists.

A delivered the reusable foundation B builds on:
- The `Asset` model (`packages/db/prisma/schema.prisma`) — Postgres `bytea`
  storage, `kind` enum `AssetKind { IMAGE, PDF }` (`PDF` already declared),
  `extractedText` column feeding a generated `searchVector`.
- `POST /api/notes/[noteId]/assets` (upload), `GET /api/assets/[id]` (serve),
  `PATCH /api/assets/[id]` (caption).
- `/api/search` already matches `Asset.searchVector` and surfaces the owning
  note.
- The editor's `FileHandler` (drop / paste) and the image NodeView.

B introduces the **async worker job** that A explicitly deferred
(A's spec: "The async extraction job is introduced in B for PDF text").

## Problem

Users cannot put PDF documents into notes. They want to drag-and-drop or
paste a PDF, see it represented in the note, open it, and have the PDF's
text content discoverable through the existing search.

## Goals

1. Insert PDFs by **drag-and-drop** and **copy-and-paste** into the editor,
   through the same `FileHandler` path images already use.
2. An inserted PDF renders as a **compact file chip** — a PDF icon, the
   filename, the humanized file size, and an "Open" link. No inline preview.
3. An **async worker job** per uploaded PDF: extracts the full text into
   `Asset.extractedText` (regenerating `searchVector`) and renders **page 1**
   to a stored PNG preview.
4. The note becomes **searchable** by the PDF's filename and full extracted
   text.

## Decisions (resolved during brainstorming)

- **Preview generation: async worker job.** One background job per PDF both
  extracts text and renders the page-1 preview. The upload returns
  immediately; no PDF-processing load sits on the web request path.
- **Editor presentation: compact file chip.** The inserted PDF is a small
  card (icon, filename, size, "Open") — the first-page preview is **not**
  shown inline. The preview still exists server-side for sub-project C.
- **Preview is rendered now, in B.** The worker job stores the page-1 PNG
  even though nothing in B displays it; C's document panel consumes it
  later. A preview serve route is therefore part of B.
- **PDF size limit: 25 MB.** Comfortably covers typical documents; the cap
  also bounds Postgres growth. Images keep their 10 MB cap — the limit is
  per-`kind`.
- **PDF processing library: `pdfjs-dist` + `@napi-rs/canvas`.** Mozilla's
  PDF.js (Apache-2.0) extracts text and drives rendering; `@napi-rs/canvas`
  (MIT) provides the canvas to rasterize page 1. Both are pure npm packages
  — nothing is added to the worker Docker image. The rejected alternatives:
  `poppler-utils` (robust, but a system package added to a curated
  Dockerfile) and `mupdf` (one WASM library, but AGPL-licensed — a concern
  for a B2B template that customers fork commercially). This choice gets an
  **ADR** (`docs/adr/0024-pdf-processing-library.md`).
- **No caption on PDF chips.** The chip is compact; search works through the
  filename and the extracted body text. PDFs leave `Asset.caption` empty and
  do not use the `PATCH /api/assets/[id]` route.

## Non-goals

- Showing the first-page preview inline in the editor — the chip is
  deliberately compact. The preview exists for sub-project C.
- The right-side document panel — sub-project C.
- **OCR of scanned / image-only PDFs.** B extracts the PDF's *text layer*.
  A scanned PDF with no text layer yields an empty `extractedText` — an
  accepted limitation; OCR is its own later sub-project.
- Multi-file drop/paste ordering guarantees — the same accepted v1
  limitation already documented for images.
- A resizable PDF chip — the chip is fixed; only images are resizable.

## Design

### 1. Data model — preview columns on `Asset`

Three new nullable columns on the existing `Asset` model
(`packages/db/prisma/schema.prisma`):

- `previewImage` — `Bytes?` (Postgres `bytea`). The rendered page-1 PNG.
  Null until the worker job completes; stays null if rendering fails or the
  asset is not a PDF.
- `previewContentType` — `String?`. `'image/png'` when `previewImage` is
  present.
- `pageCount` — `Int?`. The PDF's page count, captured for free while the
  job parses the document. Stored now so sub-project C needs neither a
  migration nor a re-extraction backfill — the same forward-compatibility
  reasoning A used when it pre-declared `AssetKind.PDF`.

The migration is plain-additive (three nullable columns, no enum, no index
change) — zero-downtime. The generated `searchVector` is unchanged: it
already covers `extractedText`, which the worker job populates.

### 2. Upload — extend `POST /api/notes/[noteId]/assets`

The existing upload route is extended, not replaced:

- Accept `application/pdf` in addition to the four image types.
- **Magic-byte validation:** a PDF body starts with `%PDF-`
  (`25 50 44 46 2D`). The MIME-sniffing helper (`asset-mime.ts`) gains PDF
  detection; the route trusts the sniffed type, not the client header.
- **Per-`kind` size cap:** PDF ≤ 25 MB, image ≤ 10 MB. The route picks the
  cap from the sniffed kind.
- On a PDF upload: create the `Asset` row with `kind: PDF`,
  `contentType: 'application/pdf'`, `extractedText: ''`,
  `previewImage: null`, then **enqueue** the `pdf.extract` job for the new
  asset id.
- Audit-log entry `assets.uploaded` (unchanged — already written).
- Response unchanged: `201` with `{ id, url }`, `url = /api/assets/<id>`.

### 3. Async worker job — `pdf.extract`

**Queue** (`packages/jobs/src/queues.ts`): a new `pdf.extract` queue added to
the `QUEUES` const. Zod payload schema `{ assetId: string }` — the job
carries only the id; the worker fetches the bytes from Postgres (per
CLAUDE.md jobs rule 6: no large payloads in Redis). A typed
`enqueuePdfExtraction(payload)` producer, validating with Zod, using
`jobId: pdf-extract:<assetId>` so a retry / re-trigger collapses. Default
job options consistent with the other queues (`attempts: 3`, exponential
backoff, bounded retention). Added to `getQueueForBullBoard`.

**Processor** (`apps/worker/src/processors/pdf-extract.ts`): a pure
`(job) => Promise<void>` wrapped in `withSpan('pdf.extract', …)`:

1. Load the `Asset` (`data`, `kind`). If missing or not `PDF`, log and
   return — nothing to retry.
2. Load the document with `pdfjs-dist` (the legacy/Node build) from the
   bytes. Capture `numPages`.
3. **Text:** iterate every page, `getTextContent()`, join the text items
   into `extractedText`.
4. **Preview:** render page 1 onto an `@napi-rs/canvas` canvas at a target
   width (~600 px, aspect-scaled from the page's viewport), then
   `canvas.encode('png')` → a PNG `Buffer`.
5. One `prisma.asset.update` writes `extractedText`, `previewImage`,
   `previewContentType: 'image/png'`, and `pageCount`. The generated
   `searchVector` regenerates from the new `extractedText`.
6. The job is **idempotent** — a retry simply re-parses and overwrites.
7. On any failure the processor throws; BullMQ retries (3×). After the final
   failure the asset keeps empty text and a null preview — the chip and the
   download still work. The failed job is retained for debugging.

**Registration** (`apps/worker/src/index.ts`): a new `Worker` for
`QUEUES.pdfExtract` with `failed` / `error` log handlers, following the
existing worker-registration pattern.

### 4. Preview serve route — `GET /api/assets/[id]/preview`

A new route handler serving the preview PNG:

- Auth-gated (`requireSession`).
- `404` when the asset id is unknown **or** `previewImage` is still null
  (job pending, failed, or not a PDF).
- On hit: the `previewImage` bytes with `Content-Type: image/png`,
  `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, and
  `Cache-Control: private, max-age=...` (a populated preview is immutable).

This route is built in B so sub-project C can consume it; B itself does not
display the preview.

### 5. Editor — the PDF file chip

- `FileHandler` (registered in A) already intercepts **drop** and **paste**.
  Add `application/pdf` to its `allowedMimeTypes`; in `onDrop` / `onPaste`,
  branch on the file's MIME type — an image takes the existing image path,
  a PDF is uploaded via `POST /api/notes/[noteId]/assets` and then inserted
  as a new `pdfChip` node at the drop / cursor position.
- New Tiptap node extension `PdfChipExtension.ts` — an **atom block node**
  (non-editable, leaf) named `pdfChip` with attributes `assetId`, `src`
  (the `/api/assets/<id>` download URL), `filename`, and `byteSize`. A React
  `NodeView` (`PdfChip.tsx`) renders the compact card: a PDF icon, the
  filename, the humanized byte size, and an "Open" link
  (`<a href={src} target="_blank" rel="noreferrer">`).
- Every chip attribute is known **synchronously** at insert time — filename
  and `byteSize` from the dropped `File`, `assetId` / `src` from the upload
  response. The chip carries no async UI state; the extracted text and
  preview are produced in the background and the chip does not reflect them.
- Upload failures reuse A's non-blocking error surface (the `onUploadError`
  notice wired in A's Task 9).
- `width` / resizing do not apply — the chip is fixed-size.

### 6. Markdown export

The `pdfChip` node's `renderHTML` emits an anchor —
`<a href="<src>">filename</a>` — so the existing "Copy as Markdown"
(Turndown) converts it with the built-in link rule to `[filename](src)`.
Confirmed by a test. No new Turndown rule required.

### 7. Search integration

**No `/api/search` code change.** A's search already matches
`Asset.searchVector` (generated over `filename` + `caption` +
`extractedText`) and surfaces the owning note. Once the `pdf.extract` job
populates `extractedText`, a note containing the PDF becomes findable by the
PDF's body text automatically. B adds an integration test confirming this
end-to-end (upload → run extraction → search by body text → note found).

### 8. Ops — Docker and dependencies

`pdfjs-dist` and `@napi-rs/canvas` are pure npm dependencies — **no system
package** is added to the worker Docker image. `@napi-rs/canvas` ships its
platform-specific prebuilt binaries (including `linux-x64-musl` /
`linux-arm64-musl` for Alpine) as `optionalDependencies`, resolved by
`bun install`, not by a postinstall build script — so the worker image's
`bun install --frozen-lockfile --ignore-scripts` is unaffected. The
implementation plan includes an explicit step to **verify the musl prebuilt
loads and renders under Bun on the Alpine image** before relying on it.

The PDF-processing library choice is recorded in
`docs/adr/0024-pdf-processing-library.md`.

### 9. Error handling

- Upload of an oversized PDF (> 25 MB), a body that is neither a valid image
  nor a valid PDF, or a magic-byte mismatch → `4xx`, consistent with A's
  image validation (`413` / `415`).
- Worker job failure → 3 retries, then the asset stays text-less and
  preview-less; the chip and the PDF download are unaffected. The failed job
  is retained for debugging.
- Preview requested before the job finishes → `404` (sub-project C handles
  the pending state in its UI).
- An encrypted or corrupt PDF that `pdfjs-dist` cannot open → the job throws,
  is retried, then fails and is logged. Accepted.

## Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `previewImage`, `previewContentType`, `pageCount` on `Asset` |
| `packages/db/prisma/migrations/<new>/migration.sql` | additive — three nullable columns |
| `packages/jobs/src/queues.ts` | `pdf.extract` queue, Zod payload schema, `enqueuePdfExtraction`, `getQueueForBullBoard` arm |
| `apps/worker/src/processors/pdf-extract.ts` | **new** — the extraction + render processor |
| `apps/worker/src/index.ts` | register the `pdf.extract` Worker |
| `apps/web/src/lib/notes/asset-mime.ts` | PDF magic-byte sniffing; per-`kind` size cap |
| `apps/web/src/lib/api/schemas.ts` | (if needed) upload query schema unchanged — note kind is sniffed |
| `apps/web/src/app/api/notes/[noteId]/assets/route.ts` | accept PDF, enqueue `pdf.extract` |
| `apps/web/src/app/api/assets/[id]/preview/route.ts` | **new** — `GET` preview serve |
| `apps/web/src/components/notes/Editor/PdfChipExtension.ts` | **new** — the `pdfChip` node + NodeView |
| `apps/web/src/components/notes/Editor/PdfChip.tsx` | **new** — the NodeView component |
| `apps/web/src/components/notes/Editor/MarkdownExtensions.ts` | register `PdfChip`; branch `FileHandler` on MIME type |
| `apps/web/src/lib/notes/api-client.ts` | (reuse `assetsApi.upload` — already file-type-agnostic) |
| `apps/web/messages/en.json`, `de.json` | chip strings ("Open", any label) |
| `apps/web/package.json`, `apps/worker/package.json` | `pdfjs-dist`, `@napi-rs/canvas` |
| `docs/adr/0024-pdf-processing-library.md` | **new** — the PDF-library ADR |
| `vitest.config.ts` | coverage `include` additions (new routes, processor, editor files) |

## Testing

The repo enforces a ≥ 90 % / ≥ 80 % coverage gate.

- **PDF MIME sniffing** — unit tests for `asset-mime.ts`: a `%PDF-` body
  sniffs as PDF; the per-kind cap is applied.
- **Upload route** — integration tests against a real Postgres: a valid PDF
  uploads (`kind: PDF`) and the `pdf.extract` job is enqueued; a PDF over
  25 MB is rejected; the existing image path still works.
- **`pdf.extract` producer** — unit tests: Zod validation, `jobId` shape.
- **`pdf-extract` processor** — integration test against a real Postgres
  with a small committed fixture PDF: `extractedText` is populated,
  `previewImage` is a non-empty PNG, `pageCount` is correct, and a second
  run is idempotent. A non-PDF / missing asset is a clean no-op.
- **Preview serve route** — integration: `200` with a PNG once the preview
  is populated; `404` when `previewImage` is null; `404` for an unknown id;
  `401` unauthenticated.
- **Search** — integration: a note becomes findable by its PDF's extracted
  body text after the job runs.
- **`PdfChipExtension`** — unit test with a headless editor: the
  `assetId` / `src` / `filename` / `byteSize` attributes round-trip.
- **`PdfChip` NodeView** — component test: renders the icon, filename,
  humanized size, and a working "Open" link.
- **Markdown export** — a test confirming a `pdfChip` node →
  `[filename](url)`.
- New coverage-gated files are added to the `vitest.config.ts` `include`
  list and tested to threshold.

## Risks

- **`@napi-rs/canvas` under Bun on Alpine.** A prebuilt native module must
  load and render correctly under the Bun runtime in the musl-based worker
  image. Mitigation: the plan verifies this explicitly before the processor
  depends on it; if the prebuilt fails, the fallback is `poppler-utils`
  (recorded as the rejected alternative in the ADR).
- **DB size from PDF blobs.** 25 MB PDFs in `bytea` grow the application
  database faster than 10 MB images. Accepted for a single-tenant notes app;
  the ADR from A already records the storage-backend tradeoff, and the
  per-kind cap bounds it.
- **Worker memory per parse.** `pdfjs-dist` holds the document and a
  rendered canvas in memory. A 25 MB PDF with many pages is the worst case;
  BullMQ concurrency is bounded by `WORKER_CONCURRENCY`, and the page-1-only
  render keeps the canvas small.
- **Scanned PDFs extract no text.** A PDF that is purely scanned images has
  no text layer — `extractedText` stays empty and the note is not findable
  by body text. This is the OCR non-goal; the filename still indexes.
- **PDF text-extraction quality.** `pdfjs-dist` text extraction is
  positional, not semantic — column order and hyphenation may be imperfect.
  Acceptable for full-text search; the `simple` tsvector config tolerates it.
