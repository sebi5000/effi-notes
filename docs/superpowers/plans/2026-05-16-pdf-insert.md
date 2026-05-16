# PDF Insert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag-drop / paste a PDF into a note as a compact file chip, with an async worker job that extracts the PDF's text (making the note searchable) and renders a stored first-page preview.

**Architecture:** B reuses sub-project A's `Asset` foundation (Postgres `bytea`, the upload/serve routes, the `FileHandler`, the generated `searchVector`). It adds three nullable preview columns to `Asset`, extends the upload route to accept `application/pdf`, introduces a `pdf.extract` BullMQ queue + worker processor (`pdfjs-dist` text extraction + `@napi-rs/canvas` page-1 render), a preview serve route, and a `pdfChip` Tiptap node.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Bun, Prisma 7 / PostgreSQL, BullMQ 5, Tiptap 3.23.4, `pdfjs-dist@5.7.284`, `@napi-rs/canvas@1.0.0`, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-pdf-insert-design.md` — read it before starting.

**Branch:** Work happens on `feat/notes-pdf` (already created off `feat/notes-assets`). Do not switch branches.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/prisma/schema.prisma` | `Asset` gains `previewImage`, `previewContentType`, `pageCount` |
| `packages/db/prisma/migrations/<new>/migration.sql` | additive — three nullable columns |
| `packages/db/src/asset-schema.test.ts` | extended — new columns round-trip |
| `docs/adr/0024-pdf-processing-library.md` | ADR for the `pdfjs-dist` + `@napi-rs/canvas` choice |
| `docs/adr/README.md` | ADR index gains a line |
| `apps/web/src/lib/notes/asset-mime.ts` | PDF magic-byte sniff; per-`kind` size caps; `sniffAssetType` |
| `apps/web/src/lib/notes/asset-mime.test.ts` | extended — PDF sniffing + caps |
| `packages/jobs/src/queues.ts` | `pdf.extract` queue, Zod schema, `enqueuePdfExtraction` |
| `packages/jobs/src/index.ts` | re-export the new symbols |
| `packages/jobs/src/queues.test.ts` | **new** — `PdfExtractJobSchema` validation |
| `apps/web/src/app/api/notes/[noteId]/assets/route.ts` | accept PDF, enqueue `pdf.extract` |
| `apps/web/src/app/api/notes/[noteId]/assets/route.test.ts` | extended — PDF upload path |
| `apps/worker/src/processors/sample-pdf.fixture.ts` | **new** — deterministic minimal-PDF generator for tests |
| `apps/worker/src/processors/pdf-render.ts` | **new** — `processPdf`: text + page count + page-1 PNG |
| `apps/worker/src/processors/pdf-render.test.ts` | **new** |
| `apps/worker/src/processors/pdf-extract.ts` | **new** — the `pdf.extract` BullMQ processor |
| `apps/worker/src/processors/pdf-extract.test.ts` | **new** |
| `apps/worker/src/index.ts` | register the `pdf.extract` Worker |
| `apps/web/src/app/api/assets/[id]/preview/route.ts` | **new** — `GET` preview serve |
| `apps/web/src/app/api/assets/[id]/preview/route.test.ts` | **new** |
| `apps/web/src/components/notes/Editor/PdfChipExtension.ts` | **new** — the `pdfChip` Tiptap node |
| `apps/web/src/components/notes/Editor/PdfChipExtension.test.ts` | **new** |
| `apps/web/src/components/notes/Editor/PdfChip.tsx` | **new** — the chip NodeView |
| `apps/web/src/components/notes/Editor/PdfChip.test.tsx` | **new** |
| `apps/web/src/components/notes/Editor/MarkdownExtensions.ts` | register `PdfChipNode`; branch `FileHandler` on MIME |
| `apps/web/src/lib/notes/markdown.test.ts` | extended — `pdfChip` → Markdown link |
| `apps/web/src/app/api/search/route.test.ts` | extended — note found via PDF body text |
| `apps/web/src/app/globals.css` | `.note-pdf-chip` styling |
| `apps/web/messages/en.json`, `de.json` | `notes.editorPdf` strings |
| `apps/worker/package.json` | `pdfjs-dist`, `@napi-rs/canvas` |
| `vitest.config.ts` | coverage `include` / `exclude` additions |

---

## Task 1: `Asset` preview columns, migration, ADR

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<new>/migration.sql` (via Prisma)
- Modify: `packages/db/src/asset-schema.test.ts`
- Create: `docs/adr/0024-pdf-processing-library.md`
- Modify: `docs/adr/README.md`

- [ ] **Step 1: Add the columns to the Prisma model**

In `packages/db/prisma/schema.prisma`, in `model Asset`, add three nullable fields immediately after the `data Bytes` line:

```prisma
  data               Bytes
  previewImage       Bytes?
  previewContentType String?
  pageCount          Int?
  createdAt          DateTime  @default(now())
```

(Keep the existing `createdAt`, `searchVector`, and `@@index` lines unchanged — just insert the three new fields before `createdAt`.)

- [ ] **Step 2: Generate the migration**

Run: `cd packages/db && bunx prisma migrate dev --create-only --name add_asset_preview_columns`
Expected: a new folder `packages/db/prisma/migrations/<timestamp>_add_asset_preview_columns/` with `migration.sql`.

- [ ] **Step 3: Verify the migration is purely additive**

Open the generated `migration.sql`. It MUST contain only three `ALTER TABLE "Asset" ADD COLUMN` statements:

```sql
ALTER TABLE "Asset" ADD COLUMN "previewImage" BYTEA;
ALTER TABLE "Asset" ADD COLUMN "previewContentType" TEXT;
ALTER TABLE "Asset" ADD COLUMN "pageCount" INTEGER;
```

If Prisma added any unrelated `DROP INDEX` / `ALTER` drift statements (it sometimes emits drift artifacts against the generated `searchVector` columns), **delete those lines** so the migration is exactly the three `ADD COLUMN`s above. All three columns are nullable — zero-downtime.

- [ ] **Step 4: Apply the migration and regenerate the client**

Run: `cd packages/db && bunx prisma migrate dev --name add_asset_preview_columns`
Expected: migration applies cleanly; `prisma generate` runs; the `Asset` type now has `previewImage`, `previewContentType`, `pageCount`.

- [ ] **Step 5: Write the failing test**

Append to `packages/db/src/asset-schema.test.ts`, inside the existing top-level `describe` block (match the file's existing seeding helpers — it already creates a user + note + asset; reuse them):

```ts
  it('round-trips the PDF preview columns', async () => {
    const { note, user } = await seedNoteAndUser();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'PDF',
        contentType: 'application/pdf',
        filename: 'doc.pdf',
        byteSize: 1024,
        data: Buffer.from('%PDF-1.4'),
        previewImage: png,
        previewContentType: 'image/png',
        pageCount: 3,
      },
    });
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.pageCount).toBe(3);
    expect(reloaded.previewContentType).toBe('image/png');
    expect(Buffer.from(reloaded.previewImage ?? []).equals(png)).toBe(true);
  });
```

NOTE: `seedNoteAndUser` is illustrative — use whatever seeding helper the existing `asset-schema.test.ts` already defines. If it has none, create the user + note inline with `prisma.user.create` / `prisma.note.create` following the pattern already in that file.

- [ ] **Step 6: Run the test**

Run: `bun run vitest packages/db/src/asset-schema.test.ts`
Expected: PASS — including the new case.

- [ ] **Step 7: Write the ADR**

Create `docs/adr/0024-pdf-processing-library.md`. Match the format of `docs/adr/0023-asset-storage-in-postgres.md` (open that file first and copy its exact heading / status / section layout). Content:

```markdown
# ADR 0024 — PDF processing library: pdfjs-dist + @napi-rs/canvas

**Status:** Accepted
**Date:** 2026-05-16

## Context

Sub-project B (PDF insert) needs the worker to do two things with an
uploaded PDF: extract its full text (for search) and render page 1 to a
PNG (a preview consumed by sub-project C). This requires a PDF parsing /
rendering library in the worker.

## Decision

Use **`pdfjs-dist`** (Mozilla PDF.js, Apache-2.0) for parsing and text
extraction, and **`@napi-rs/canvas`** (MIT) as the canvas backend that
rasterises page 1. Both are plain npm packages. `@napi-rs/canvas` ships
prebuilt platform binaries — including `linux-x64-musl` and
`linux-arm64-musl` — as `optionalDependencies`, so nothing is added to the
worker's Alpine Docker image and `bun install --ignore-scripts` is
unaffected.

## Consequences

- No system package is added to the curated worker Dockerfile.
- Both dependencies are permissively licensed — safe for a B2B template
  that customers fork commercially.
- `@napi-rs/canvas` is a prebuilt native module; the implementation plan
  verifies it loads and renders under Bun, and the worker Docker image
  build confirms the musl prebuilt resolves on Alpine.
- Rejected: **`poppler-utils`** — robust native CLI tools, but they would
  add a system package to the Dockerfile and an ops surface. Kept as the
  documented fallback if `@napi-rs/canvas` fails under Bun/Alpine.
- Rejected: **`mupdf`** — a single WASM library covering both needs, but
  AGPL-licensed, which is a concern for a commercially-forked template.

## References

- Spec: `docs/superpowers/specs/2026-05-16-pdf-insert-design.md`
- ADR 0023 — asset storage in Postgres
```

- [ ] **Step 8: Register the ADR in the index**

In `docs/adr/README.md`, add a row/line for ADR 0024 following the exact format of the existing entries (the 0023 line is the precedent).

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/asset-schema.test.ts docs/adr/0024-pdf-processing-library.md docs/adr/README.md
git commit -m "feat(notes): Asset preview columns + PDF-library ADR"
```

---

## Task 2: PDF MIME sniffing + per-kind size caps

**Files:**
- Modify: `apps/web/src/lib/notes/asset-mime.ts`
- Modify: `apps/web/src/lib/notes/asset-mime.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/notes/asset-mime.test.ts` (match the existing import style — it imports from `./asset-mime.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { maxBytesForKind, sniffAssetType } from './asset-mime.ts';

describe('sniffAssetType', () => {
  it('detects a PDF from the %PDF- magic bytes', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(sniffAssetType(pdf)).toEqual({ contentType: 'application/pdf', kind: 'PDF' });
  });

  it('detects a PNG image and reports the IMAGE kind', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffAssetType(png)).toEqual({ contentType: 'image/png', kind: 'IMAGE' });
  });

  it('returns null for an unrecognised body', () => {
    expect(sniffAssetType(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('maxBytesForKind', () => {
  it('caps images at 10 MB and PDFs at 25 MB', () => {
    expect(maxBytesForKind('IMAGE')).toBe(10 * 1024 * 1024);
    expect(maxBytesForKind('PDF')).toBe(25 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/lib/notes/asset-mime.test.ts`
Expected: FAIL — `sniffAssetType` / `maxBytesForKind` not exported.

- [ ] **Step 3: Implement**

Rewrite `apps/web/src/lib/notes/asset-mime.ts` so it keeps `sniffImageType` and `SupportedImageType` unchanged and adds the new exports. Replace the `MAX_ASSET_BYTES` line and append the new code:

```ts
/** Per-kind byte caps. Enforced by the upload route. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** The asset kinds the upload route accepts (mirrors the Prisma `AssetKind`). */
export type AssetKindName = 'IMAGE' | 'PDF';

/** The canonical MIME types this app accepts. */
export type SupportedAssetType = SupportedImageType | 'application/pdf';
```

(Keep `SupportedImageType` and the whole `sniffImageType` function exactly as they are.) Then add, at the end of the file:

```ts
/** True when the body's leading bytes are the PDF signature `%PDF-`. */
const isPdf = (b: Uint8Array): boolean =>
  b.length >= 5 &&
  b[0] === 0x25 &&
  b[1] === 0x50 &&
  b[2] === 0x44 &&
  b[3] === 0x46 &&
  b[4] === 0x2d;

/**
 * Detect a supported asset type from a file's leading magic bytes. Returns
 * the canonical MIME type and the matching `AssetKind`, or `null` for an
 * unsupported body. The upload route trusts this, never the client header.
 */
export const sniffAssetType = (
  bytes: Uint8Array,
): { contentType: SupportedAssetType; kind: AssetKindName } | null => {
  const image = sniffImageType(bytes);
  if (image !== null) return { contentType: image, kind: 'IMAGE' };
  if (isPdf(bytes)) return { contentType: 'application/pdf', kind: 'PDF' };
  return null;
};

/** The byte cap for a given asset kind. */
export const maxBytesForKind = (kind: AssetKindName): number =>
  kind === 'PDF' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
```

If the existing `asset-mime.test.ts` referenced `MAX_ASSET_BYTES`, update that reference to `MAX_IMAGE_BYTES`.

- [ ] **Step 4: Run the tests**

Run: `bun run vitest apps/web/src/lib/notes/asset-mime.test.ts`
Expected: PASS — old and new cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/asset-mime.ts apps/web/src/lib/notes/asset-mime.test.ts
git commit -m "feat(notes): PDF magic-byte sniffing + per-kind size caps"
```

---

## Task 3: `pdf.extract` queue + producer

**Files:**
- Modify: `packages/jobs/src/queues.ts`
- Modify: `packages/jobs/src/index.ts`
- Create: `packages/jobs/src/queues.test.ts`

- [ ] **Step 1: Add the queue, schema, and producer**

In `packages/jobs/src/queues.ts`:

1. Add `pdfExtract` to the `QUEUES` const:

```ts
export const QUEUES = {
  demo: 'demo',
  notesSnapshot: 'notes.snapshot',
  pdfExtract: 'pdf.extract',
} as const;
```

2. After the `notes.snapshot` schema block, add the `pdf.extract` schema:

```ts
// ── pdf.extract queue ───────────────────────────────────────────────────────
// One job per uploaded PDF asset. The worker fetches the bytes from Postgres
// (the job carries only the id — see CLAUDE.md jobs rule 6).
export const PdfExtractJobSchema = z.object({
  assetId: z.string().min(1),
});
export type PdfExtractPayload = z.infer<typeof PdfExtractJobSchema>;
```

3. After the `notes.snapshot` producer block, add the `pdf.extract` queue + producer (mirror the `notesSnapshot` lazy-singleton pattern):

```ts
// ── pdf.extract producer ────────────────────────────────────────────────────
let pdfExtractQueue: Queue<PdfExtractPayload> | undefined;
const getPdfExtractQueue = (): Queue<PdfExtractPayload> => {
  if (pdfExtractQueue) return pdfExtractQueue;
  pdfExtractQueue = new Queue<PdfExtractPayload>(QUEUES.pdfExtract, {
    connection: getRedis(),
    defaultJobOptions: defaultJobOpts,
  });
  return pdfExtractQueue;
};

/** Producer entry point used by the upload route. Validates payload via Zod. */
export const enqueuePdfExtraction = async (payload: PdfExtractPayload): Promise<string> => {
  const validated = PdfExtractJobSchema.parse(payload);
  // jobId keyed on the asset so a re-trigger / retry collapses.
  const job = await getPdfExtractQueue().add('extract', validated, {
    jobId: `pdf-extract:${validated.assetId}`,
  });
  return job.id ?? '';
};
```

4. Extend `getQueueForBullBoard` with the new arm:

```ts
export const getQueueForBullBoard = (name: QueueName): Queue => {
  if (name === QUEUES.demo) return getDemoQueue() as Queue;
  if (name === QUEUES.notesSnapshot) return getNotesSnapshotQueue() as Queue;
  if (name === QUEUES.pdfExtract) return getPdfExtractQueue() as Queue;
  throw new Error(`Unknown queue: ${name as string}`);
};
```

- [ ] **Step 2: Re-export from the package index**

In `packages/jobs/src/index.ts`, add the new symbols to the export block from `./queues.ts`:

```ts
export {
  type DemoJobPayload,
  DemoJobSchema,
  enqueueDemoJob,
  enqueueNotesSnapshot,
  enqueuePdfExtraction,
  getDemoQueueCounts,
  getQueueForBullBoard,
  NotesSnapshotJobSchema,
  type NotesSnapshotPayload,
  PdfExtractJobSchema,
  type PdfExtractPayload,
  QUEUES,
  type QueueName,
} from './queues.ts';
```

- [ ] **Step 3: Write the producer-schema test**

Create `packages/jobs/src/queues.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PdfExtractJobSchema } from './queues.ts';

describe('PdfExtractJobSchema', () => {
  it('accepts a non-empty assetId', () => {
    expect(PdfExtractJobSchema.parse({ assetId: 'abc123' })).toEqual({ assetId: 'abc123' });
  });

  it('rejects an empty assetId', () => {
    expect(PdfExtractJobSchema.safeParse({ assetId: '' }).success).toBe(false);
  });

  it('rejects a missing assetId', () => {
    expect(PdfExtractJobSchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test + typecheck**

Run: `bun run vitest packages/jobs/src/queues.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/queues.ts packages/jobs/src/index.ts packages/jobs/src/queues.test.ts
git commit -m "feat(jobs): pdf.extract queue + enqueuePdfExtraction producer"
```

---

## Task 4: Upload route — accept PDF, enqueue the job

**Files:**
- Modify: `apps/web/src/app/api/notes/[noteId]/assets/route.ts`
- Modify: `apps/web/src/app/api/notes/[noteId]/assets/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/web/src/app/api/notes/[noteId]/assets/route.test.ts`. At the very top of the file (before the other imports — the `@app/jobs` mock must be hoisted), add a mock so the route's `enqueuePdfExtraction` call does not touch Redis:

```ts
import { vi } from 'vitest';

vi.mock('@app/jobs', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, enqueuePdfExtraction: vi.fn(async () => 'fake-job') };
});
```

Then add an import of the mocked function near the other imports:

```ts
import { enqueuePdfExtraction } from '@app/jobs';
```

Add these cases inside the existing `describe` for the upload route (reuse the file's existing helpers — `makeTestUser`, `authedAs`/`setAuthed`, the note-seeding helper, and the `mockedAuth` reset):

```ts
  it('uploads a PDF, stores kind PDF, and enqueues extraction', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'pdf-up', authorId: user.id } });
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const res = await POST(
      new Request(`http://localhost/api/notes/${note.id}/assets?filename=report.pdf`, {
        method: 'POST',
        body: pdf,
      }),
      { params: Promise.resolve({ noteId: note.id }) },
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.kind).toBe('PDF');
    expect(asset.contentType).toBe('application/pdf');
    expect(vi.mocked(enqueuePdfExtraction)).toHaveBeenCalledWith({ assetId: id });
  });

  it('rejects a PDF larger than 25 MB', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'pdf-big', authorId: user.id } });
    const big = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(25 * 1024 * 1024 + 1)]);
    const res = await POST(
      new Request(`http://localhost/api/notes/${note.id}/assets?filename=big.pdf`, {
        method: 'POST',
        body: big,
      }),
      { params: Promise.resolve({ noteId: note.id }) },
    );
    expect(res.status).toBe(413);
  });
```

NOTE: match the exact helper names the file already uses (the spec reviewer for A noted the file uses `authedAs` / `setAuthed` and `makeTestUser`). If the existing "oversized" image test relied on `MAX_ASSET_BYTES`, update it to `MAX_IMAGE_BYTES` and ensure its body is an oversized **valid PNG** so it still asserts `413` (see Step 3 — sniff now runs before the size check).

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest "apps/web/src/app/api/notes/[noteId]/assets/route.test.ts"`
Expected: FAIL — the route still rejects PDFs (`sniffImageType` returns null → 415).

- [ ] **Step 3: Implement the route changes**

Edit `apps/web/src/app/api/notes/[noteId]/assets/route.ts`:

1. Update the imports:

```ts
import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { enqueuePdfExtraction } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, requireSession } from '@/lib/api/responses.ts';
import { assetUploadQuerySchema } from '@/lib/api/schemas.ts';
import { maxBytesForKind, sniffAssetType } from '@/lib/notes/asset-mime.ts';
```

2. Replace the body-validation + create block (everything from `const buffer = ...` to the end of the `withSpan` callback) with:

```ts
  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.byteLength === 0) return jsonError(400, 'empty body');

  const sniffed = sniffAssetType(buffer);
  if (sniffed === null) return jsonError(415, 'unsupported file type');
  if (buffer.byteLength > maxBytesForKind(sniffed.kind)) {
    return jsonError(413, 'file too large');
  }

  return withSpan(
    'assets.upload',
    { 'asset.bytes': buffer.byteLength, 'asset.kind': sniffed.kind },
    async () => {
      const asset = await prisma.asset.create({
        data: {
          noteId,
          authorId: user.id,
          kind: sniffed.kind,
          contentType: sniffed.contentType,
          filename: parsed.data.filename,
          byteSize: buffer.byteLength,
          data: buffer,
        },
        select: { id: true },
      });
      if (sniffed.kind === 'PDF') {
        await enqueuePdfExtraction({ assetId: asset.id });
      }
      await recordAudit({
        action: 'assets.uploaded',
        actorId: user.id,
        subject: asset.id,
        metadata: { noteId, contentType: sniffed.contentType },
      });
      log.info(
        { assetId: asset.id, noteId, contentType: sniffed.contentType },
        'asset uploaded',
      );
      return jsonCreated({ id: asset.id, url: `/api/assets/${asset.id}` });
    },
  );
```

Also update the route's doc comment so it no longer says "upload an image" — say "upload an image or PDF".

- [ ] **Step 4: Run the tests**

Run: `bun run vitest "apps/web/src/app/api/notes/[noteId]/assets/route.test.ts"`
Expected: PASS — image cases and the two new PDF cases.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/notes/[noteId]/assets/route.ts" "apps/web/src/app/api/notes/[noteId]/assets/route.test.ts"
git commit -m "feat(notes): upload route accepts PDFs and enqueues extraction"
```

---

## Task 5: PDF render/extract helper — install libs + `pdf-render.ts`

**Files:**
- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/processors/sample-pdf.fixture.ts`
- Create: `apps/worker/src/processors/pdf-render.ts`
- Create: `apps/worker/src/processors/pdf-render.test.ts`

- [ ] **Step 1: Add the dependencies**

In `apps/worker/package.json` `"dependencies"`, add (keep the block alphabetised):

```json
    "@napi-rs/canvas": "1.0.0",
    "pdfjs-dist": "5.7.284",
```

Run: `bun install`
Expected: resolves; both packages installed. (Verify they exist: `npm view pdfjs-dist@5.7.284 version` and `npm view @napi-rs/canvas@1.0.0 version`.)

- [ ] **Step 2: Create the test-fixture PDF generator**

Create `apps/worker/src/processors/sample-pdf.fixture.ts`. This builds a valid minimal one-page PDF with a known text string, computing xref offsets dynamically (so it is always valid — no hand-tuned offsets):

```ts
/**
 * Test-only helper. Builds a valid minimal single-page PDF containing the
 * given text, with a Helvetica text object so `pdfjs-dist` can both extract
 * the text and render the page. Object byte-offsets for the xref table are
 * computed as the body is assembled, so the output is always well-formed.
 */
export const makeSamplePdf = (text: string): Buffer => {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const stream = `BT /F1 24 Tf 40 120 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(body, 'latin1');
};
```

- [ ] **Step 3: Write the failing test**

Create `apps/worker/src/processors/pdf-render.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { processPdf } from './pdf-render.ts';
import { makeSamplePdf } from './sample-pdf.fixture.ts';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe('processPdf', () => {
  it('extracts the text, page count, and a PNG preview', async () => {
    const pdf = makeSamplePdf('Findable PDF content');
    const result = await processPdf(new Uint8Array(pdf));

    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('Findable');
    expect(result.text).toContain('content');
    expect(result.previewPng.byteLength).toBeGreaterThan(0);
    expect([...result.previewPng.subarray(0, 4)]).toEqual(PNG_MAGIC);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `bun run vitest apps/worker/src/processors/pdf-render.test.ts`
Expected: FAIL — `processPdf` not defined.

- [ ] **Step 5: Implement `pdf-render.ts`**

Create `apps/worker/src/processors/pdf-render.ts`:

```ts
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Result of parsing + rendering a PDF. */
export type PdfRenderResult = {
  /** Concatenated text of every page. */
  text: string;
  /** Total page count. */
  pageCount: number;
  /** Page 1 rendered to a PNG. */
  previewPng: Buffer;
};

/** Target width (px) of the rendered page-1 preview. Height keeps the aspect. */
const PREVIEW_WIDTH = 600;

/**
 * Parse a PDF: extract all text, count pages, and render page 1 to a PNG.
 * Used by the `pdf.extract` worker processor.
 */
export const processPdf = async (data: Uint8Array): Promise<PdfRenderResult> => {
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  const pageCount = doc.numPages;

  const parts: string[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  const text = parts.join('\n').trim();

  const firstPage = await doc.getPage(1);
  const unit = firstPage.getViewport({ scale: 1 });
  const viewport = firstPage.getViewport({ scale: PREVIEW_WIDTH / unit.width });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await firstPage.render({
    // @napi-rs/canvas' 2D context satisfies the subset pdf.js renders into.
    canvasContext: context as unknown as Parameters<typeof firstPage.render>[0]['canvasContext'],
    viewport,
    canvas: canvas as unknown as Parameters<typeof firstPage.render>[0]['canvas'],
  }).promise;
  const previewPng = canvas.toBuffer('image/png');

  await doc.cleanup();
  return { text, pageCount, previewPng };
};
```

NOTE — this is the riskiest code in the plan. Verify it against the **installed** `pdfjs-dist@5.7.284`:
- The Node import path is `pdfjs-dist/legacy/build/pdf.mjs`. If that file does not exist in `node_modules/pdfjs-dist/`, use the path that does (check `node_modules/pdfjs-dist/legacy/build/` and the package `exports` map) — the **legacy** build is the one for non-browser runtimes.
- `pdfjs-dist` rendering in a non-DOM runtime may need globals (`DOMMatrix`, `Path2D`, `ImageData`). `@napi-rs/canvas` exports them — if `render()` throws a `ReferenceError`, assign them onto `globalThis` once at module load: `import { DOMMatrix, Path2D, ImageData } from '@napi-rs/canvas'` then `globalThis.DOMMatrix ??= DOMMatrix` (etc.).
- The `render()` parameter shape (`canvasContext` / `canvas` / `viewport`) may differ slightly in 5.x — consult `node_modules/pdfjs-dist/types/` and adjust. The `as unknown as Parameters<...>` casts above keep TypeScript happy without `any`; if the real types let you drop the cast, do so.
- If pdf.js logs a missing-worker warning, it is harmless (the legacy build runs a fake worker in-process). Only act if rendering actually fails.
The `processPdf` test (Step 3) is the proof — iterate the glue until it passes. Do **not** introduce `any` without a `// reason:` comment.

- [ ] **Step 6: Run the test**

Run: `bun run vitest apps/worker/src/processors/pdf-render.test.ts`
Expected: PASS — text extracted, `pageCount` 1, PNG preview produced.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/package.json bun.lock apps/worker/src/processors/sample-pdf.fixture.ts apps/worker/src/processors/pdf-render.ts apps/worker/src/processors/pdf-render.test.ts
git commit -m "feat(worker): processPdf — text extraction + page-1 PNG render"
```

---

## Task 6: `pdf.extract` processor + worker registration

**Files:**
- Create: `apps/worker/src/processors/pdf-extract.ts`
- Create: `apps/worker/src/processors/pdf-extract.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/processors/pdf-extract.test.ts` (integration — real Postgres, following the `notes-snapshot.test.ts` pattern):

```ts
import { prisma } from '@app/db';
import type { PdfExtractPayload } from '@app/jobs';
import type { Job } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processPdfExtract } from './pdf-extract.ts';
import { makeSamplePdf } from './sample-pdf.fixture.ts';

const TEST_PREFIX = 'pdf-extract-';

const cleanup = async () => {
  await prisma.asset.deleteMany({
    where: { note: { author: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.note.deleteMany({ where: { author: { email: { startsWith: TEST_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
};

const seed = async (pdf: Buffer) => {
  const user = await prisma.user.create({
    data: {
      keycloakSub: `${TEST_PREFIX}sub-${crypto.randomUUID()}`,
      email: `${TEST_PREFIX}${crypto.randomUUID()}@example.invalid`,
      displayName: 'Pdf',
      roles: ['user'],
    },
  });
  const note = await prisma.note.create({ data: { title: 'pdf-note', authorId: user.id } });
  return prisma.asset.create({
    data: {
      noteId: note.id,
      authorId: user.id,
      kind: 'PDF',
      contentType: 'application/pdf',
      filename: 'doc.pdf',
      byteSize: pdf.byteLength,
      data: pdf,
    },
  });
};

const fakeJob = (assetId: string): Job<PdfExtractPayload> =>
  ({ id: 'job-1', data: { assetId }, log: async () => undefined }) as unknown as Job<PdfExtractPayload>;

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('processPdfExtract', () => {
  it('writes extracted text, a preview PNG, and the page count', async () => {
    const asset = await seed(makeSamplePdf('Indexable body words'));
    await processPdfExtract(fakeJob(asset.id));

    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.extractedText).toContain('Indexable');
    expect(reloaded.pageCount).toBe(1);
    expect(reloaded.previewContentType).toBe('image/png');
    expect((reloaded.previewImage?.byteLength ?? 0)).toBeGreaterThan(0);
  });

  it('is idempotent — a second run overwrites with the same result', async () => {
    const asset = await seed(makeSamplePdf('Repeatable text'));
    await processPdfExtract(fakeJob(asset.id));
    await processPdfExtract(fakeJob(asset.id));
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.extractedText).toContain('Repeatable');
  });

  it('is a no-op for a missing asset', async () => {
    await expect(processPdfExtract(fakeJob('does-not-exist'))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/worker/src/processors/pdf-extract.test.ts`
Expected: FAIL — `processPdfExtract` not defined.

- [ ] **Step 3: Implement the processor**

Create `apps/worker/src/processors/pdf-extract.ts`:

```ts
import { prisma } from '@app/db';
import type { PdfExtractPayload } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import type { Job } from 'bullmq';
import { processPdf } from './pdf-render.ts';

const log = createLogger({ component: 'processor.pdf.extract' });

/**
 * Extracts a PDF asset's text and renders its first-page preview, then writes
 * both (plus the page count) back to the `Asset` row. The generated
 * `searchVector` regenerates from the new `extractedText`. Idempotent — a
 * retry simply re-parses and overwrites. Enqueued by the asset upload route.
 */
export const processPdfExtract = async (job: Job<PdfExtractPayload>): Promise<void> =>
  withSpan('pdf.extract', { 'job.id': job.id ?? '', 'asset.id': job.data.assetId }, async () => {
    const { assetId } = job.data;
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, kind: true, data: true },
    });
    if (!asset || asset.kind !== 'PDF') {
      log.warn({ assetId }, 'pdf.extract — asset missing or not a PDF; skipping');
      return;
    }

    const { text, pageCount, previewPng } = await processPdf(new Uint8Array(asset.data));

    await prisma.asset.update({
      where: { id: assetId },
      data: {
        extractedText: text,
        pageCount,
        previewImage: previewPng,
        previewContentType: 'image/png',
      },
    });
    await job.log(`pdf.extract assetId=${assetId} pages=${pageCount} chars=${text.length}`);
    log.info({ assetId, pageCount, chars: text.length }, 'pdf extracted');
  });
```

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/worker/src/processors/pdf-extract.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Register the Worker in the worker entry**

In `apps/worker/src/index.ts`:

1. Add the processor import next to the others:

```ts
import { processNotesSnapshot } from './processors/notes-snapshot.ts';
import { processPdfExtract } from './processors/pdf-extract.ts';
```

2. After the `snapshotWorker` block (before the `── Internal HTTP server ──` section), add:

```ts
const pdfExtractWorker = new Worker(QUEUES.pdfExtract, processPdfExtract, {
  connection: getRedis(),
  // PDF parsing + rasterising is CPU-heavy; keep concurrency modest.
  concurrency: 2,
});

pdfExtractWorker.on('failed', (job, err) => {
  log.error(
    { jobId: job?.id, err: err.message, queue: QUEUES.pdfExtract },
    'pdf extraction job failed',
  );
});

pdfExtractWorker.on('error', (err) => {
  log.error({ err: err.message, queue: QUEUES.pdfExtract }, 'pdf extraction worker error');
});
```

3. In the `shutdown` function, add `pdfExtractWorker` to the drain sequence:

```ts
    await demoWorker.close();
    await snapshotWorker.close();
    await pdfExtractWorker.close();
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS — `apps/worker` and all packages.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/processors/pdf-extract.ts apps/worker/src/processors/pdf-extract.test.ts apps/worker/src/index.ts
git commit -m "feat(worker): pdf.extract processor + worker registration"
```

---

## Task 7: Preview serve route — `GET /api/assets/[id]/preview`

**Files:**
- Create: `apps/web/src/app/api/assets/[id]/preview/route.ts`
- Create: `apps/web/src/app/api/assets/[id]/preview/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/api/assets/[id]/preview/route.test.ts`. Mirror the auth-mock + helper pattern of the sibling `apps/web/src/app/api/assets/[id]/route.test.ts` (open it first and copy its `vi.mock('@/auth', …)` block, its imports, and its `cleanupNotesDomain` / `makeTestUser` / `authedAs` / `unauthed` usage):

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
import { authedAs, cleanupNotesDomain, makeTestUser, unauthed } from '@/lib/api/test-session.ts';
import { GET } from './route.ts';

const mockedAuth = vi.mocked(auth);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const seedPdfAsset = async (authorId: string, withPreview: boolean) => {
  const note = await prisma.note.create({ data: { title: 'prev-note', authorId } });
  return prisma.asset.create({
    data: {
      noteId: note.id,
      authorId,
      kind: 'PDF',
      contentType: 'application/pdf',
      filename: 'doc.pdf',
      byteSize: 64,
      data: Buffer.from('%PDF-1.4'),
      ...(withPreview ? { previewImage: PNG, previewContentType: 'image/png' } : {}),
    },
  });
};

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/assets/[id]/preview', () => {
  it('401 when unauthenticated', async () => {
    unauthed(mockedAuth);
    const res = await GET(new Request('http://localhost/api/assets/x/preview'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('404 for an unknown id', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const res = await GET(new Request('http://localhost/api/assets/missing/preview'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('404 when the preview has not been rendered yet', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedPdfAsset(user.id, false);
    const res = await GET(new Request(`http://localhost/api/assets/${asset.id}/preview`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(res.status).toBe(404);
  });

  it('serves the preview PNG once rendered', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedPdfAsset(user.id, true);
    const res = await GET(new Request(`http://localhost/api/assets/${asset.id}/preview`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });
});
```

NOTE: confirm the exact helper names against the installed `test-session.ts` (A's serve-route test imports `authedAs, cleanupNotesDomain, makeTestUser, unauthed` from `@/lib/api/test-session.ts` — reuse those).

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest "apps/web/src/app/api/assets/[id]/preview/route.test.ts"`
Expected: FAIL — `./route.ts` does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/assets/[id]/preview/route.ts`:

```ts
import { prisma } from '@app/db';
import { jsonError, requireSession } from '@/lib/api/responses.ts';

/**
 * GET /api/assets/[id]/preview — serve a PDF asset's rendered first-page
 * preview PNG (auth-gated). `404` until the `pdf.extract` worker job has
 * populated `previewImage`. Built for sub-project C's document panel.
 */
export const GET = async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { previewImage: true, previewContentType: true },
  });
  if (!asset || asset.previewImage === null) return jsonError(404, 'preview not found');

  return new Response(Buffer.from(asset.previewImage), {
    status: 200,
    headers: {
      'content-type': asset.previewContentType ?? 'image/png',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=86400',
    },
  });
};
```

- [ ] **Step 4: Run the tests**

Run: `bun run vitest "apps/web/src/app/api/assets/[id]/preview/route.test.ts"`
Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/assets/[id]/preview"
git commit -m "feat(notes): GET /api/assets/[id]/preview serve route"
```

---

## Task 8: `pdfChip` Tiptap node + NodeView + styling + i18n

**Files:**
- Create: `apps/web/src/components/notes/Editor/PdfChipExtension.ts`
- Create: `apps/web/src/components/notes/Editor/PdfChipExtension.test.ts`
- Create: `apps/web/src/components/notes/Editor/PdfChip.tsx`
- Create: `apps/web/src/components/notes/Editor/PdfChip.test.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

- [ ] **Step 1: Add the i18n strings**

In `apps/web/messages/en.json`, inside the `notes` object, immediately after the `"editorImage"` block, add:

```json
    "editorPdf": {
      "open": "Open",
      "iconLabel": "PDF document"
    },
```

In `apps/web/messages/de.json`, in the same place:

```json
    "editorPdf": {
      "open": "Öffnen",
      "iconLabel": "PDF-Dokument"
    },
```

- [ ] **Step 2: Write the failing extension test**

Create `apps/web/src/components/notes/Editor/PdfChipExtension.test.ts`:

```ts
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { describe, expect, it } from 'vitest';
import { PdfChipNode } from './PdfChipExtension.ts';

describe('PdfChipNode', () => {
  it('is registered as an atom block node named pdfChip', () => {
    const schema = getSchema([Document, Paragraph, Text, PdfChipNode]);
    const type = schema.nodes.pdfChip;
    expect(type).toBeDefined();
    expect(type?.isAtom).toBe(true);
    expect(type?.isBlock).toBe(true);
  });

  it('round-trips its attributes through createAndFill', () => {
    const schema = getSchema([Document, Paragraph, Text, PdfChipNode]);
    const node = schema.nodes.pdfChip?.create({
      assetId: 'a1',
      src: '/api/assets/a1',
      filename: 'report.pdf',
      byteSize: 2048,
    });
    expect(node?.attrs).toMatchObject({
      assetId: 'a1',
      src: '/api/assets/a1',
      filename: 'report.pdf',
      byteSize: 2048,
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun run vitest apps/web/src/components/notes/Editor/PdfChipExtension.test.ts`
Expected: FAIL — `./PdfChipExtension.ts` does not exist.

- [ ] **Step 4: Implement the extension**

Create `apps/web/src/components/notes/Editor/PdfChipExtension.ts`:

```ts
import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PdfChip } from './PdfChip.tsx';

/**
 * The editor's PDF node — an atom block rendered as a compact file chip
 * (icon + filename + size + Open link) by the `PdfChip` NodeView. Attributes
 * round-trip through `data-*` HTML attributes; `renderHTML` emits an anchor
 * so "Copy as Markdown" (Turndown) converts it to `[filename](src)`.
 */
export const PdfChipNode = Node.create({
  name: 'pdfChip',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-id'),
        renderHTML: (attrs) =>
          attrs.assetId ? { 'data-asset-id': String(attrs.assetId) } : {},
      },
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute('href') ?? el.getAttribute('data-src'),
        renderHTML: (attrs) => (attrs.src ? { href: String(attrs.src) } : {}),
      },
      filename: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-filename') ?? el.textContent ?? '',
        renderHTML: (attrs) =>
          attrs.filename ? { 'data-filename': String(attrs.filename) } : {},
      },
      byteSize: {
        default: 0,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-byte-size');
          const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
          return Number.isFinite(n) ? n : 0;
        },
        renderHTML: (attrs) =>
          attrs.byteSize ? { 'data-byte-size': String(attrs.byteSize) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-pdf-chip]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'a',
      { ...HTMLAttributes, 'data-pdf-chip': '' },
      String(node.attrs.filename ?? ''),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfChip);
  },
});
```

- [ ] **Step 5: Write the failing NodeView test**

Create `apps/web/src/components/notes/Editor/PdfChip.test.tsx`:

```tsx
import { NextIntlClientProvider } from 'next-intl';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PdfChip } from './PdfChip.tsx';

const messages = { notes: { editorPdf: { open: 'Open', iconLabel: 'PDF document' } } };

const renderChip = (attrs: Record<string, unknown>) => {
  // The NodeView only reads `node.attrs`; a minimal stub is enough.
  const props = { node: { attrs } } as unknown as Parameters<typeof PdfChip>[0];
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PdfChip {...props} />
    </NextIntlClientProvider>,
  );
};

describe('PdfChip', () => {
  it('renders the filename, a humanised size, and an Open link', () => {
    renderChip({
      assetId: 'a1',
      src: '/api/assets/a1',
      filename: 'report.pdf',
      byteSize: 2 * 1024 * 1024,
    });
    expect(screen.getByText('report.pdf')).toBeDefined();
    expect(screen.getByText('2.0 MB')).toBeDefined();
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('href')).toBe('/api/assets/a1');
  });

  it('formats small sizes in KB', () => {
    renderChip({ assetId: 'a2', src: '/api/assets/a2', filename: 'tiny.pdf', byteSize: 4096 });
    expect(screen.getByText('4 KB')).toBeDefined();
  });
});
```

NOTE: confirm `@testing-library/react` is the component-test tool A's `ResizableImage.test.tsx` uses; if it uses a different render helper, match it. The `NodeViewWrapper` from `@tiptap/react` renders a plain element outside an editor context — if it throws without an editor, wrap the component test the same way `ResizableImage.test.tsx` handles it (open that file and follow its exact setup).

- [ ] **Step 6: Run to verify failure**

Run: `bun run vitest apps/web/src/components/notes/Editor/PdfChip.test.tsx`
Expected: FAIL — `./PdfChip.tsx` does not exist.

- [ ] **Step 7: Implement the NodeView**

Create `apps/web/src/components/notes/Editor/PdfChip.tsx`:

```tsx
'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useTranslations } from 'next-intl';

/** Humanises a byte count for display in the chip. */
const humanSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * NodeView for the editor's `pdfChip` node — a compact, non-editable card:
 * a PDF badge, the filename, the humanised file size, and an "Open" link to
 * the asset download. The first-page preview is rendered server-side (for
 * sub-project C) and is intentionally not shown here.
 */
export function PdfChip({ node }: NodeViewProps) {
  const t = useTranslations('notes.editorPdf');
  const src = String(node.attrs.src ?? '');
  const filename = String(node.attrs.filename ?? '');
  const byteSize = typeof node.attrs.byteSize === 'number' ? node.attrs.byteSize : 0;

  return (
    <NodeViewWrapper as="div" className="note-pdf-chip" data-testid="pdf-chip">
      <span className="note-pdf-chip-icon" aria-label={t('iconLabel')}>
        PDF
      </span>
      <span className="note-pdf-chip-name">{filename}</span>
      <span className="note-pdf-chip-size">{humanSize(byteSize)}</span>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="note-pdf-chip-open"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {t('open')}
      </a>
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 8: Add the chip styling**

Append to the end of `apps/web/src/app/globals.css`:

```css
/* Editor PDF chip — a compact, non-editable file card. */
.prose-paper .note-pdf-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.6em;
  margin: 0.6em 0;
  padding: 0.45em 0.7em;
  border: 1px solid var(--color-paper-line, #d8d2c4);
  border-radius: 6px;
  background: var(--color-background);
  font-size: 0.9em;
}
.prose-paper .note-pdf-chip-icon {
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  color: #fff;
  background: #b3261e;
}
.prose-paper .note-pdf-chip-name {
  font-weight: 500;
}
.prose-paper .note-pdf-chip-size {
  color: var(--color-muted-foreground);
}
.prose-paper .note-pdf-chip-open {
  margin-left: 0.3em;
  color: var(--color-accent);
  text-decoration: underline;
}
```

NOTE: use the CSS custom properties that already exist in `globals.css` (A's image styling used `--color-accent`, `--color-background`, `--color-muted-foreground`). If `--color-paper-line` is not a defined token, use whatever border token A's `.note-image-frame` styling used.

- [ ] **Step 9: Run the tests**

Run: `bun run vitest apps/web/src/components/notes/Editor/PdfChipExtension.test.ts apps/web/src/components/notes/Editor/PdfChip.test.tsx`
Expected: PASS — both files.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/notes/Editor/PdfChipExtension.ts apps/web/src/components/notes/Editor/PdfChipExtension.test.ts apps/web/src/components/notes/Editor/PdfChip.tsx apps/web/src/components/notes/Editor/PdfChip.test.tsx apps/web/src/app/globals.css apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(notes): pdfChip editor node + compact-chip NodeView"
```

---

## Task 9: Wire the PDF chip into the editor + Markdown export

**Files:**
- Modify: `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`
- Modify: `apps/web/src/lib/notes/markdown.test.ts`

- [ ] **Step 1: Write the failing Markdown-export test**

Append inside the `describe('htmlToMarkdown', …)` block in `apps/web/src/lib/notes/markdown.test.ts`:

```ts
  it('converts a PDF chip anchor to a Markdown link', () => {
    const md = htmlToMarkdown('<a data-pdf-chip href="/api/assets/a1">report.pdf</a>');
    expect(md).toBe('[report.pdf](/api/assets/a1)');
  });
```

- [ ] **Step 2: Run to verify the test exists**

Run: `bun run vitest apps/web/src/lib/notes/markdown.test.ts`
Expected: PASS already — Turndown's built-in link rule handles `<a href>` with no converter change. (If the exact output differs — e.g. Turndown trims or escapes — adjust the expectation to Turndown's actual output; do **not** add a converter rule.)

- [ ] **Step 3: Register `PdfChipNode` and branch the FileHandler**

Edit `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`:

1. Add the import next to the `NoteImage` import:

```ts
import { NoteImage } from './ImageExtension.ts';
import { PdfChipNode } from './PdfChipExtension.ts';
```

2. Replace the `uploadAndInsert` helper body so it branches on the file type:

```ts
  const uploadAndInsert = (editor: Editor, file: File, pos: number): void => {
    void assetsApi
      .upload(input.noteId, file)
      .then(({ id, url }) => {
        const content =
          file.type === 'application/pdf'
            ? {
                type: 'pdfChip',
                attrs: { assetId: id, src: url, filename: file.name, byteSize: file.size },
              }
            : { type: 'image', attrs: { src: url } };
        editor.chain().insertContentAt(pos, content).run();
      })
      .catch(() => {
        // upload failed — surface a non-blocking notice; the editor stays usable
        input.onUploadError();
      });
  };
```

3. Add `PdfChipNode` to the returned extension array, immediately after `NoteImage`:

```ts
    Callout,
    NoteImage,
    PdfChipNode,
    FileHandler.configure({
```

4. Add `'application/pdf'` to the `FileHandler` `allowedMimeTypes`:

```ts
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'],
```

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun run lint`
Expected: PASS (pre-existing unrelated warnings acceptable).

- [ ] **Step 5: Run the Markdown test**

Run: `bun run vitest apps/web/src/lib/notes/markdown.test.ts`
Expected: PASS — including the PDF-chip case.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Editor/MarkdownExtensions.ts apps/web/src/lib/notes/markdown.test.ts
git commit -m "feat(notes): insert PDFs as chips via drag-drop / paste"
```

---

## Task 10: Search integration test + full verification

**Files:**
- Modify: `apps/web/src/app/api/search/route.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the coverage-gated files**

In `vitest.config.ts`, in `test.coverage.include`, add four entries (next to the related existing ones):

```ts
        'apps/web/src/components/notes/Editor/ImageExtension.ts',
        'apps/web/src/components/notes/Editor/ResizableImage.tsx',
        'apps/web/src/components/notes/Editor/PdfChipExtension.ts',
        'apps/web/src/components/notes/Editor/PdfChip.tsx',
```

and, next to `'apps/worker/src/processors/notes-snapshot.ts'`:

```ts
        'apps/worker/src/processors/notes-snapshot.ts',
        'apps/worker/src/processors/pdf-extract.ts',
        'apps/worker/src/processors/pdf-render.ts',
```

In `test.coverage.exclude`, add the test-only fixture so it is not measured:

```ts
        'apps/web/src/lib/api/test-session.ts',
        'apps/worker/src/processors/sample-pdf.fixture.ts',
```

(The new routes are already covered by the existing `apps/web/src/app/api/notes/**/route.ts` and `apps/web/src/app/api/assets/**/route.ts` globs; `asset-mime.ts` by `apps/web/src/lib/notes/**/*.ts`.)

- [ ] **Step 2: Write the search integration test**

Append to `apps/web/src/app/api/search/route.test.ts` a case proving a note is found by its PDF's extracted text. Match the file's existing pattern (it already seeds notes + assets and calls the search `GET`; reuse its helpers):

```ts
  it('finds a note via an embedded PDF asset extracted text', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'pdf-search', authorId: user.id } });
    await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'PDF',
        contentType: 'application/pdf',
        filename: 'manual.pdf',
        byteSize: 64,
        data: Buffer.from('%PDF-1.4'),
        extractedText: 'quarterly logistics throughput analysis',
      },
    });
    const res = await GET(new Request('http://localhost/api/search?q=logistics'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Array<{ id: string }> };
    expect(body.hits.some((h) => h.id === note.id)).toBe(true);
  });
```

NOTE: confirm the search response shape and helper names against the existing `search/route.test.ts` (A's Task 6 added asset-match tests there — copy their exact request URL form, auth setup, and result-shape assertion). The `searchVector` is generated, so setting `extractedText` on `create` is enough — no job run needed in this test.

- [ ] **Step 3: Run the search test**

Run: `bun run vitest apps/web/src/app/api/search/route.test.ts`
Expected: PASS — including the new PDF case.

- [ ] **Step 4: Type + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5: Full test suite with coverage**

Ensure Postgres + Redis are running (`docker ps`; `make up` if not). Run:

Run: `bun run test --coverage`
Expected: PASS — all tests green; coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The new coverage-gated files — `pdf-extract.ts`, `pdf-render.ts`, `PdfChipExtension.ts`, `PdfChip.tsx`, and the new routes — must each stay above threshold.

- [ ] **Step 6: If coverage dips below threshold**

Identify the uncovered lines and add targeted tests to the matching `*.test.ts(x)` file. Re-run Step 5. Commit any added tests:

```bash
git add apps/web/src apps/worker/src
git commit -m "test(notes): close coverage gap in PDF feature"
```

If coverage is already fine, skip this step.

- [ ] **Step 7: Next build**

Run: `bun run build`
Expected: the Next build of `apps/web` and the worker build complete with no error.

- [ ] **Step 8: Worker Docker image build (Alpine / musl verification)**

This confirms `@napi-rs/canvas` resolves its `linux-*-musl` prebuilt inside the worker's Alpine image. If Docker is available:

Run: `docker compose build worker`
Expected: the build completes — `bun install --frozen-lockfile` resolves `@napi-rs/canvas` and `pdfjs-dist` with no error.

If Docker is not available in this environment, skip the command but report it as **not verified** — note that the musl prebuilt resolution is then an open risk to confirm before deploy (the ADR records `poppler-utils` as the fallback).

- [ ] **Step 9: Commit any remaining changes + working-tree check**

```bash
git add vitest.config.ts apps/web/src/app/api/search/route.test.ts
git commit -m "test(notes): coverage gate + search-by-PDF-text integration test"
```

Run: `git status --short`
Expected: no uncommitted changes from this plan's files. Pre-existing untracked items (`.vscode/`, `bunfig.toml`, `scripts/`) and a regenerated `apps/web/next-env.d.ts` are unrelated — report but do not commit them.

---

## Self-Review

**Spec coverage:**
- Spec §1 (preview columns on `Asset`) → Task 1. ✅
- Spec §2 (upload accepts PDF, per-kind cap, enqueue) → Task 2 (sniff + caps) + Task 4 (route). ✅
- Spec §3 (`pdf.extract` queue + processor: text + page-1 render + `pageCount`) → Task 3 (queue) + Task 5 (`processPdf`) + Task 6 (processor + worker registration). ✅
- Spec §4 (preview serve route) → Task 7. ✅
- Spec §5 (FileHandler branch, `pdfChip` atom node + NodeView, sync attributes, reuse `onUploadError`) → Task 8 (node + NodeView) + Task 9 (FileHandler wiring). ✅
- Spec §6 (Markdown export `pdfChip` → `[filename](url)`) → Task 9 Step 1. ✅
- Spec §7 (search — no code change, test only) → Task 10 Step 2. ✅
- Spec §8 (ops — pure-npm deps, ADR, musl build check) → Task 1 (ADR) + Task 5 (install) + Task 10 Step 8. ✅
- Spec §9 (error handling — non-PDF/oversized 4xx, missing-asset no-op, preview 404) → Task 4 (413), Task 6 (`!asset || kind !== 'PDF'` no-op + test), Task 7 (404 when null). ✅
- Testing section → every task is TDD; new gated files added to `vitest.config.ts` in Task 10. ✅

**Placeholder scan:** No TBD/TODO. The `<new>` migration-folder name (Task 1) is a Prisma-generated timestamp that cannot be pre-printed — the steps name the `--name` flag and the precise SQL to expect. The "verify against the installed package" directives in Task 5 (pdf.js Node API) and the "match the existing file's helpers" notes (Tasks 1, 4, 7, 8, 10) are explicit, bounded verification instructions against named files/packages — the same pattern A's plan used and its self-review accepted — not vague placeholders.

**Type consistency:** `sniffAssetType` returns `{ contentType, kind }` (Task 2), consumed by the upload route (Task 4). `AssetKindName` (`'IMAGE' | 'PDF'`) matches the Prisma `AssetKind` enum. `enqueuePdfExtraction({ assetId })` / `PdfExtractPayload` (Task 3) are imported by the upload route (Task 4) and the processor (Task 6) with the matching shape. `processPdf(data) → { text, pageCount, previewPng }` (Task 5) is consumed by `processPdfExtract` (Task 6), which writes `extractedText` / `pageCount` / `previewImage` / `previewContentType` — the exact columns added in Task 1. `PdfChipNode` (Task 8) is registered in `MarkdownExtensions.ts` (Task 9); the `pdfChip` node `type` and its `assetId`/`src`/`filename`/`byteSize` attributes match between the node definition (Task 8), the `insertContentAt` call (Task 9), and the extension test (Task 8). `makeSamplePdf` (Task 5 fixture) is imported by `pdf-render.test.ts` (Task 5) and `pdf-extract.test.ts` (Task 6). The preview route selects `previewImage`/`previewContentType` (Task 7) — the Task 1 columns.
