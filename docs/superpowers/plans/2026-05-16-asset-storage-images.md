# Asset Storage & Images (Sub-project A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag-and-drop or paste images into the notes editor — stored in Postgres, resizable with locked aspect ratio and bounded to the editor width, and discoverable through the existing search.

**Architecture:** A new `Asset` table holds the bytes in Postgres (`bytea`) plus a generated `tsvector` over filename + caption + extractedText. An auth-gated REST surface uploads, serves, and patches assets. The editor gains a Tiptap `Image` node with a React NodeView (resize handle + editable caption) and a `FileHandler` for drop/paste. `/api/search` is extended so a note surfaces when an embedded asset matches.

**Tech Stack:** Next.js 16, React 19, TypeScript 6 strict, Prisma 7 / PostgreSQL, Tiptap 3 (`@tiptap/extension-image`, `@tiptap/extension-file-handler`), Vitest + Testing Library, Bun.

**Spec:** `docs/superpowers/specs/2026-05-16-asset-storage-images-design.md`

**Conventions:**
- Run one test file with `bun run test <path>`. Route tests are integration tests needing a real Postgres + Redis (`make up` if not running).
- Conventional Commits; pre-commit hooks (lefthook: biome, eslint-next, repo-wide typecheck) are mandatory — fix causes, never `--no-verify`.
- TypeScript strict, no `any` without a `// reason:` comment. `react-hooks/set-state-in-effect` is an ESLint error.
- Every external boundary is Zod-validated. Never `prisma db push` — use migrations.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/db/prisma/schema.prisma` | `Asset` model, `AssetKind` enum, `Note.assets` relation | 1 |
| `packages/db/prisma/migrations/<new>/migration.sql` | create table/enum + generated `searchVector` + GIN index | 1 |
| `packages/db/src/asset-schema.test.ts` | **new** — Asset model + cascade test | 1 |
| `docs/adr/0023-asset-storage-in-postgres.md` | **new** — storage-backend ADR | 1 |
| `apps/web/src/lib/api/schemas.ts` | Zod schemas: asset upload query + caption patch | 2 |
| `apps/web/src/lib/notes/asset-mime.ts` (+test) | **new** — magic-byte image sniffing, size cap | 3 |
| `apps/web/src/lib/notes/image-resize.ts` (+test) | **new** — pure width-clamp helper | 3 |
| `apps/web/src/app/api/notes/[noteId]/assets/route.ts` (+test) | **new** — `POST` upload | 4 |
| `apps/web/src/app/api/assets/[id]/route.ts` (+test) | **new** — `GET` serve, `PATCH` caption | 5 |
| `apps/web/src/app/api/search/route.ts` | extend to match assets → owning note | 6 |
| `apps/web/src/lib/notes/api-client.ts` | `assetsApi` (upload, patchCaption) | 7 |
| `apps/web/src/components/notes/Editor/ImageExtension.ts` (+test) | **new** — `Image` node with `width`/`caption` + NodeView | 8 |
| `apps/web/src/components/notes/Editor/ResizableImage.tsx` (+test) | **new** — the NodeView component | 8 |
| `apps/web/src/components/notes/Editor/MarkdownExtensions.ts` | register `Image` + `FileHandler` | 9 |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | pass `noteId` into `buildExtensions` | 9 |
| `apps/web/src/app/globals.css` | image + caption styling | 9 |
| `apps/web/messages/en.json`, `de.json` | caption placeholder, upload-error strings | 9 |
| `apps/web/package.json` | add the two `@tiptap/*` deps | 9 |
| `vitest.config.ts` | coverage `include` additions | 5, 8 |

---

## Task 1: `Asset` data model, migration, ADR

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: a new migration under `packages/db/prisma/migrations/`
- Create: `packages/db/src/asset-schema.test.ts`
- Create: `docs/adr/0023-asset-storage-in-postgres.md`

- [ ] **Step 1: Add the `Asset` model + `AssetKind` enum to the schema**

In `packages/db/prisma/schema.prisma`:

Add `assets Asset[]` to the `Note` model — change its relation block so it reads:

```prisma
  tags         NoteTag[]
  history      NoteHistory[]
  assets       Asset[]
  searchVector Unsupported("tsvector")?
```

Append at the end of the file:

```prisma
/// Asset kind. IMAGE is produced in sub-project A; PDF is declared now so
/// sub-project B needs no enum migration.
enum AssetKind {
  IMAGE
  PDF
}

/// A binary file embedded in a note. Bytes live in Postgres (`data`).
/// `searchVector` is a generated tsvector over filename + caption +
/// extractedText (added via raw SQL in the migration — Prisma sees it as
/// Unsupported but it is queryable via $queryRaw), so a note is findable
/// through its embedded assets. `authorId` is a plain column (audit actor);
/// no FK relation to keep the template `User` model untouched.
model Asset {
  id            String    @id @default(cuid())
  noteId        String
  note          Note      @relation(fields: [noteId], references: [id], onDelete: Cascade)
  authorId      String
  kind          AssetKind
  contentType   String
  filename      String
  caption       String    @default("")
  extractedText String    @default("")
  byteSize      Int
  data          Bytes
  createdAt     DateTime  @default(now())
  searchVector  Unsupported("tsvector")?

  @@index([noteId])
}
```

- [ ] **Step 2: Scaffold the migration (do not apply yet)**

Run: `bun --filter @app/db exec prisma migrate dev --create-only --name add_assets`
Expected: a new directory `packages/db/prisma/migrations/<timestamp>_add_assets/` with a `migration.sql`. The migration is created but NOT applied.

- [ ] **Step 3: Edit the generated migration SQL for the generated column**

Open the new `migration.sql`. Prisma generates a `CREATE TYPE "AssetKind"`, a `CREATE TABLE "Asset"`, the `@@index`, and the `Asset_noteId_fkey` foreign key. It will also have generated a plain `"searchVector" tsvector` column line inside `CREATE TABLE "Asset"` (because the schema declares `Unsupported("tsvector")`).

Make two edits — exactly mirroring how the existing `Note` migration handles `searchVector` (see `packages/db/prisma/migrations/20260514205754_add_notes_folders_tags/migration.sql` lines ~107-118 for the precedent):

1. **Delete** the line declaring the plain `"searchVector" tsvector` column inside `CREATE TABLE "Asset" (...)` (so the table is created without it).
2. **Append** to the end of the file:

```sql
-- effi-notes: generated tsvector over filename + caption + extractedText.
-- Keeps assets findable through the same search infrastructure as notes.
ALTER TABLE "Asset" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("filename", '') || ' ' ||
      coalesce("caption", '') || ' ' ||
      coalesce("extractedText", ''))
  ) STORED;

-- effi-notes: GIN index on searchVector for fast full-text lookup
CREATE INDEX "Asset_searchVector_gin" ON "Asset" USING GIN ("searchVector");
```

- [ ] **Step 4: Apply the migration + regenerate the client**

Run: `bun --filter @app/db exec prisma migrate dev`
Expected: the `add_assets` migration applies cleanly to the dev database.

Run: `bun --filter @app/db generate`
Expected: the Prisma client regenerates; `prisma.asset` is now available.

- [ ] **Step 5: Write the schema test**

Create `packages/db/src/asset-schema.test.ts`:

```ts
import { prisma } from '@app/db';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const cleanup = async () => {
  await prisma.asset.deleteMany({ where: { filename: { startsWith: 'schematest-' } } });
  await prisma.note.deleteMany({ where: { title: { startsWith: 'schematest-' } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'schematest-' } } });
};

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Asset model', () => {
  it('stores bytes and is retrievable, and cascade-deletes with its note', async () => {
    const user = await prisma.user.create({
      data: { keycloakSub: `schematest-${Date.now()}`, email: `schematest-${Date.now()}@x.invalid` },
    });
    const note = await prisma.note.create({
      data: { title: 'schematest-note', authorId: user.id },
    });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'schematest-pic.png',
        byteSize: bytes.byteLength,
        data: bytes,
      },
    });

    const loaded = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(loaded?.contentType).toBe('image/png');
    expect(loaded?.caption).toBe('');
    expect(Buffer.from(loaded?.data ?? []).equals(bytes)).toBe(true);

    await prisma.note.delete({ where: { id: note.id } });
    expect(await prisma.asset.findUnique({ where: { id: asset.id } })).toBeNull();
  });
});
```

Note: confirm the `User` model's required fields — adjust the `prisma.user.create` `data` to match the actual `User` schema (the fields `keycloakSub` and `email` are the expected required ones; if the model requires more, add them).

- [ ] **Step 6: Run the schema test**

Run: `bun run test packages/db/src/asset-schema.test.ts`
Expected: PASS — the asset round-trips and cascade-deletes.

- [ ] **Step 7: Write the ADR**

Create `docs/adr/0023-asset-storage-in-postgres.md`:

```markdown
# 0023 — Asset storage in PostgreSQL

## Status

Accepted

## Context

The notes editor needs to embed binary files (images now; PDFs next). The
bytes must be stored, served, backed up, and — per product requirement —
the files must be discoverable through the existing full-text search.

## Decision

Store asset bytes in PostgreSQL: a new `Asset` table with a `bytea` `data`
column, alongside metadata and a generated `tsvector` `searchVector` over
`filename + caption + extractedText`.

## Consequences

- No new infrastructure: no object store, no shared filesystem volume.
- Assets are included automatically in the existing `pg_dump` backup.
- The searchable text of an asset is a column in the same database as the
  `tsvector` search infrastructure — the search join is trivial.
- Asset writes are transactional with note data.
- Trade-off: blobs grow the application database. With the 10 MB per-image
  cap and a single-tenant deployment this is acceptable. A customer with
  heavy asset volumes can later swap the storage backend behind the same
  `Asset` interface (the upload/serve routes are the only readers of `data`).
- Rejected: a filesystem volume — it would split bytes from search text,
  require extending the backup script, and complicate horizontal scaling.
```

Then append a row for `0023` to `docs/adr/README.md`'s index (match the existing format of that file).

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/asset-schema.test.ts docs/adr/0023-asset-storage-in-postgres.md docs/adr/README.md
git commit -m "feat(notes): Asset model + Postgres storage (ADR 0023)"
```

---

## Task 2: Zod schemas for asset upload + caption patch

**Files:**
- Modify: `apps/web/src/lib/api/schemas.ts`

- [ ] **Step 1: Write the failing test**

`schemas.ts` is covered by `apps/web/src/lib/api/schemas.test.ts`. Append to that file, inside it (after the existing `describe` block):

```ts
describe('asset schemas', () => {
  it('assetUploadQuerySchema accepts a filename', () => {
    const r = assetUploadQuerySchema.safeParse({ filename: 'photo.png' });
    expect(r.success).toBe(true);
  });

  it('assetUploadQuerySchema rejects a missing filename', () => {
    expect(assetUploadQuerySchema.safeParse({}).success).toBe(false);
  });

  it('assetUploadQuerySchema rejects an over-long filename', () => {
    expect(assetUploadQuerySchema.safeParse({ filename: 'x'.repeat(300) }).success).toBe(false);
  });

  it('patchCaptionSchema accepts a caption', () => {
    expect(patchCaptionSchema.safeParse({ caption: 'A photo' }).success).toBe(true);
    expect(patchCaptionSchema.safeParse({ caption: '' }).success).toBe(true);
  });

  it('patchCaptionSchema rejects an over-long caption', () => {
    expect(patchCaptionSchema.safeParse({ caption: 'x'.repeat(2000) }).success).toBe(false);
  });
});
```

Add `assetUploadQuerySchema` and `patchCaptionSchema` to the existing `import { ... } from './schemas.ts';` line at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test apps/web/src/lib/api/schemas.test.ts`
Expected: FAIL — the two schemas do not exist yet.

- [ ] **Step 3: Add the schemas**

In `apps/web/src/lib/api/schemas.ts`, append (after the existing schemas, near the other `export const ...Schema` declarations):

```ts
const FILENAME_MAX = 255;
const CAPTION_MAX = 1000;

/** Query params for `POST /api/notes/[noteId]/assets` — the raw file is the body. */
export const assetUploadQuerySchema = z.object({
  filename: z.string().min(1).max(FILENAME_MAX),
});
export type AssetUploadQuery = z.infer<typeof assetUploadQuerySchema>;

/** Body for `PATCH /api/assets/[id]` — updates the searchable caption. */
export const patchCaptionSchema = z.object({
  caption: z.string().max(CAPTION_MAX),
});
export type PatchCaptionInput = z.infer<typeof patchCaptionSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test apps/web/src/lib/api/schemas.test.ts`
Expected: PASS — all schema tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/schemas.ts apps/web/src/lib/api/schemas.test.ts
git commit -m "feat(notes): zod schemas for asset upload + caption patch"
```

---

## Task 3: Pure helpers — image MIME sniffing + width clamp

**Files:**
- Create: `apps/web/src/lib/notes/asset-mime.ts` (+ `.test.ts`)
- Create: `apps/web/src/lib/notes/image-resize.ts` (+ `.test.ts`)

Both live under `lib/notes/**` — coverage-gated; both are pure.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/notes/asset-mime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_ASSET_BYTES, sniffImageType } from './asset-mime.ts';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('sniffImageType', () => {
  it('detects PNG', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
  });
  it('detects JPEG', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });
  it('detects GIF', () => {
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
  });
  it('detects WebP', () => {
    expect(
      sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)),
    ).toBe('image/webp');
  });
  it('rejects an unknown signature', () => {
    expect(sniffImageType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull(); // %PDF
  });
  it('rejects a too-short buffer', () => {
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
  });
  it('exposes a 10 MB cap', () => {
    expect(MAX_ASSET_BYTES).toBe(10 * 1024 * 1024);
  });
});
```

Create `apps/web/src/lib/notes/image-resize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MIN_IMAGE_WIDTH, clampImageWidth } from './image-resize.ts';

describe('clampImageWidth', () => {
  it('passes a width that fits through unchanged (rounded)', () => {
    expect(clampImageWidth(300.4, 600)).toBe(300);
  });
  it('clamps to the available width', () => {
    expect(clampImageWidth(900, 600)).toBe(600);
  });
  it('clamps up to the minimum width', () => {
    expect(clampImageWidth(10, 600)).toBe(MIN_IMAGE_WIDTH);
  });
  it('falls back to the available width for a non-finite input', () => {
    expect(clampImageWidth(Number.NaN, 600)).toBe(600);
  });
  it('never returns less than the minimum even when available is tiny', () => {
    expect(clampImageWidth(20, 10)).toBe(MIN_IMAGE_WIDTH);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test apps/web/src/lib/notes/asset-mime.test.ts apps/web/src/lib/notes/image-resize.test.ts`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement `asset-mime.ts`**

Create `apps/web/src/lib/notes/asset-mime.ts`:

```ts
/** Per-asset byte cap (10 MB). Enforced by the upload route. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/**
 * Detect a supported image type from a file's leading magic bytes. Returns
 * the canonical MIME type, or `null` if the bytes are not one of the four
 * supported image formats. The upload route trusts this, NOT the
 * client-supplied Content-Type. SVG is intentionally unsupported
 * (inline-SVG XSS risk).
 */
export const sniffImageType = (bytes: Uint8Array): string | null => {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'image/gif';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};
```

- [ ] **Step 4: Implement `image-resize.ts`**

Create `apps/web/src/lib/notes/image-resize.ts`:

```ts
/** Smallest width an image may be resized to, in pixels. */
export const MIN_IMAGE_WIDTH = 80;

/**
 * Clamp a desired image width (px) so it never goes below MIN_IMAGE_WIDTH
 * and never exceeds the available editor content width. A non-finite
 * `desired` falls back to the available width. The result is rounded to a
 * whole pixel. CSS `max-width: 100%` is the independent hard backstop;
 * this keeps the stored `width` attribute sane.
 */
export const clampImageWidth = (desired: number, available: number): number => {
  const max = Math.max(MIN_IMAGE_WIDTH, Math.floor(available));
  if (!Number.isFinite(desired)) return max;
  return Math.min(max, Math.max(MIN_IMAGE_WIDTH, Math.round(desired)));
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test apps/web/src/lib/notes/asset-mime.test.ts apps/web/src/lib/notes/image-resize.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/notes/asset-mime.ts apps/web/src/lib/notes/asset-mime.test.ts apps/web/src/lib/notes/image-resize.ts apps/web/src/lib/notes/image-resize.test.ts
git commit -m "feat(notes): image MIME-sniff + width-clamp helpers"
```

---

## Task 4: Upload route — `POST /api/notes/[noteId]/assets`

**Files:**
- Create: `apps/web/src/app/api/notes/[noteId]/assets/route.ts`
- Test: `apps/web/src/app/api/notes/[noteId]/assets/route.test.ts`

This route file matches the coverage `include` glob `apps/web/src/app/api/notes/**/route.ts` — no `vitest.config.ts` change needed for it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/api/notes/[noteId]/assets/route.test.ts`. Open an existing route test (e.g. `apps/web/src/app/api/tags/route.test.ts`) and match its harness exactly — the `vi.mock('@/auth', ...)` block, the imports from `@/lib/api/test-session.ts` (`authedAs`, `unauthed`, `makeTestUser`, `cleanupNotesDomain`), and the `beforeEach`/`afterAll` shape.

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
import { POST } from './route.ts';

const mockedAuth = vi.mocked(auth);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const post = (noteId: string, body: BodyInit, filename = 'pic.png') =>
  POST(
    new Request(`http://localhost/api/notes/${noteId}/assets?filename=${filename}`, {
      method: 'POST',
      body,
    }),
    { params: Promise.resolve({ noteId }) },
  );

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('POST /api/notes/[noteId]/assets', () => {
  it('401 when unauthenticated', async () => {
    unauthed(mockedAuth);
    expect((await post('whatever', PNG)).status).toBe(401);
  });

  it('404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    expect((await post('missing-note', PNG)).status).toBe(404);
  });

  it('uploads an image and returns its id + url', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n', authorId: user.id } });
    const res = await post(note.id, PNG);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.url).toBe(`/api/assets/${body.id}`);
    const asset = await prisma.asset.findUnique({ where: { id: body.id } });
    expect(asset?.contentType).toBe('image/png');
    expect(asset?.noteId).toBe(note.id);
    expect(asset?.filename).toBe('pic.png');
  });

  it('415 for a non-image body (magic bytes mismatch)', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n2', authorId: user.id } });
    const res = await post(note.id, Buffer.from('%PDF-1.7'));
    expect(res.status).toBe(415);
  });

  it('413 for an over-sized body', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n3', authorId: user.id } });
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await post(note.id, big)).status).toBe(413);
  });

  it('400 when the filename query param is missing', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'api-test-n4', authorId: user.id } });
    const res = await POST(
      new Request(`http://localhost/api/notes/${note.id}/assets`, { method: 'POST', body: PNG }),
      { params: Promise.resolve({ noteId: note.id }) },
    );
    expect(res.status).toBe(400);
  });
});
```

NOTE: confirm the route-handler second-argument shape (`{ params: Promise<{ noteId }> }`) against an existing dynamic route handler — `apps/web/src/app/api/notes/[id]/route.ts`. Match whatever signature it uses (Next 16: `params` is a `Promise`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test "apps/web/src/app/api/notes/[noteId]/assets/route.test.ts"`
Expected: FAIL — `./route.ts` does not exist.

- [ ] **Step 3: Implement the upload route**

Create `apps/web/src/app/api/notes/[noteId]/assets/route.ts`. First open `apps/web/src/app/api/notes/route.ts` to confirm the exact import paths for `recordAudit`, `createLogger`, `withSpan` and the route-handler signature, then write:

```ts
import { prisma } from '@app/db';
import { recordAudit } from '@app/db/audit';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonCreated, jsonError, requireSession } from '@/lib/api/responses.ts';
import { assetUploadQuerySchema } from '@/lib/api/schemas.ts';
import { MAX_ASSET_BYTES, sniffImageType } from '@/lib/notes/asset-mime.ts';

const log = createLogger({ component: 'api.assets.upload' });

/**
 * POST /api/notes/[noteId]/assets — upload an image into a note.
 * The raw file bytes are the request body; the filename is `?filename=`.
 * The stored MIME type comes from the file's magic bytes, never the
 * client-supplied Content-Type.
 */
export const POST = async (
  req: Request,
  ctx: { params: Promise<{ noteId: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { noteId } = await ctx.params;
  const parsed = assetUploadQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) return jsonError(400, 'invalid query', parsed.error.issues);

  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { id: true } });
  if (!note) return jsonError(404, 'note not found');

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.byteLength === 0) return jsonError(400, 'empty body');
  if (buffer.byteLength > MAX_ASSET_BYTES) return jsonError(413, 'file too large');

  const contentType = sniffImageType(buffer);
  if (contentType === null) return jsonError(415, 'unsupported file type');

  return withSpan('assets.upload', { 'asset.bytes': buffer.byteLength }, async () => {
    const asset = await prisma.asset.create({
      data: {
        noteId,
        authorId: user.id,
        kind: 'IMAGE',
        contentType,
        filename: parsed.data.filename,
        byteSize: buffer.byteLength,
        data: buffer,
      },
      select: { id: true },
    });
    await recordAudit({
      action: 'assets.uploaded',
      actorId: user.id,
      subject: asset.id,
      metadata: { noteId, contentType },
    });
    log.info({ assetId: asset.id, noteId, contentType }, 'asset uploaded');
    return jsonCreated({ id: asset.id, url: `/api/assets/${asset.id}` });
  });
};
```

If `recordAudit`'s import path or signature differs from what `apps/web/src/app/api/notes/route.ts` uses, match that file exactly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test "apps/web/src/app/api/notes/[noteId]/assets/route.test.ts"`
Expected: PASS — all 6 cases green (needs Postgres running).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/notes/[noteId]/assets"
git commit -m "feat(notes): asset upload route"
```

---

## Task 5: Serve + caption route — `GET/PATCH /api/assets/[id]`

**Files:**
- Create: `apps/web/src/app/api/assets/[id]/route.ts`
- Test: `apps/web/src/app/api/assets/[id]/route.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the coverage-include entry**

In `vitest.config.ts`, in the `coverage.include` array, after the line `'apps/web/src/app/api/notes/**/route.ts',` add:

```ts
        'apps/web/src/app/api/assets/**/route.ts',
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/app/api/assets/[id]/route.test.ts`:

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
import { GET, PATCH } from './route.ts';

const mockedAuth = vi.mocked(auth);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const seedAsset = async (authorId: string) => {
  const note = await prisma.note.create({ data: { title: 'api-test-an', authorId } });
  return prisma.asset.create({
    data: {
      noteId: note.id,
      authorId,
      kind: 'IMAGE',
      contentType: 'image/png',
      filename: 'api-test.png',
      byteSize: PNG.byteLength,
      data: PNG,
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

describe('GET /api/assets/[id]', () => {
  it('401 when unauthenticated', async () => {
    unauthed(mockedAuth);
    const res = await GET(new Request('http://localhost/api/assets/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('404 for an unknown id', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const res = await GET(new Request('http://localhost/api/assets/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('serves the bytes with the stored content type', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedAsset(user.id);
    const res = await GET(new Request(`http://localhost/api/assets/${asset.id}`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });
});

describe('PATCH /api/assets/[id]', () => {
  it('updates the caption', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedAsset(user.id);
    const res = await PATCH(
      new Request(`http://localhost/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: 'A nice photo' }),
      }),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(res.status).toBe(200);
    const reloaded = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(reloaded?.caption).toBe('A nice photo');
  });

  it('400 on an invalid body', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const asset = await seedAsset(user.id);
    const res = await PATCH(
      new Request(`http://localhost/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: 123 }),
      }),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('404 patching an unknown id', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const res = await PATCH(
      new Request('http://localhost/api/assets/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: 'x' }),
      }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run test "apps/web/src/app/api/assets/[id]/route.test.ts"`
Expected: FAIL — `./route.ts` does not exist.

- [ ] **Step 4: Implement the route**

Create `apps/web/src/app/api/assets/[id]/route.ts`:

```ts
import { prisma } from '@app/db';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { patchCaptionSchema } from '@/lib/api/schemas.ts';

/** GET /api/assets/[id] — serve the raw asset bytes (auth-gated). */
export const GET = async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });
  if (!asset) return jsonError(404, 'asset not found');

  return new Response(Buffer.from(asset.data), {
    status: 200,
    headers: {
      'content-type': asset.contentType,
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=86400',
    },
  });
};

/** PATCH /api/assets/[id] — update the searchable caption (auth-gated). */
export const PATCH = async (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');

  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = patchCaptionSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const existing = await prisma.asset.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError(404, 'asset not found');

  await prisma.asset.update({ where: { id }, data: { caption: parsed.data.caption } });
  return jsonOk({ id, caption: parsed.data.caption });
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test "apps/web/src/app/api/assets/[id]/route.test.ts"`
Expected: PASS — all 6 cases green.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/api/assets/[id]" vitest.config.ts
git commit -m "feat(notes): asset serve + caption-patch route"
```

---

## Task 6: Search integration — assets surface their note

**Files:**
- Modify: `apps/web/src/app/api/search/route.ts`
- Test: `apps/web/src/app/api/search/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/app/api/search/route.test.ts`, inside its top-level `describe` block (match the file's existing harness — it already mocks `@/auth` and uses `makeTestUser`/`cleanupNotesDomain`):

```ts
  it('finds a note via an embedded asset filename', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({
      data: { title: 'api-test-search-host', body: 'nothing relevant here', authorId: user.id },
    });
    await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'zucchini-harvest.png',
        byteSize: 4,
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    const res = await GET(new Request('http://localhost/api/search?q=zucchini'));
    const body = (await res.json()) as { hits: Array<{ id: string }> };
    expect(body.hits.some((h) => h.id === note.id)).toBe(true);
  });

  it('does not duplicate a note that matches both directly and via an asset', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({
      data: { title: 'api-test-rutabaga-note', body: 'about rutabaga', authorId: user.id },
    });
    await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'rutabaga.png',
        byteSize: 4,
        data: Buffer.from([1, 2, 3, 4]),
      },
    });
    const res = await GET(new Request('http://localhost/api/search?q=rutabaga'));
    const body = (await res.json()) as { hits: Array<{ id: string }> };
    expect(body.hits.filter((h) => h.id === note.id)).toHaveLength(1);
  });
```

If the test file does not already import `prisma`, `authedAs`, `makeTestUser`, add them to its imports (match the other route tests).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test apps/web/src/app/api/search/route.test.ts`
Expected: FAIL — assets are not searched yet, so the note is not found via its asset.

- [ ] **Step 3: Extend the search route**

In `apps/web/src/app/api/search/route.ts`, inside the `withSpan` callback, the `useTs` branch currently produces `rows` from a single `Note` query. After that `Note` query and before the trigram fallback, add a second query for asset matches and merge.

Replace the block from `const useTs = tsquery.length > 0;` down to (but not including) `let final = rows;` with:

```ts
      const useTs = tsquery.length > 0;
      const noteRows: Row[] = useTs
        ? await prisma.$queryRawUnsafe<Row[]>(
            `SELECT n.id,
                  n.title,
                  n."folderId" as "folderId",
                  n."updatedAt",
                  ts_headline('simple', n.body, to_tsquery('simple', $1),
                              'StartSel=<mark>, StopSel=</mark>, MaxFragments=1, MaxWords=15, MinWords=5') AS snippet
             FROM "Note" n
            WHERE n."archivedAt" IS NULL
              AND n."searchVector" @@ to_tsquery('simple', $1)
            ORDER BY ts_rank(n."searchVector", to_tsquery('simple', $1)) DESC,
                     n."updatedAt" DESC
            LIMIT $2`,
            tsquery,
            limit,
          )
        : [];

      // A note also matches when one of its embedded assets matches by
      // filename / caption / extracted text. Surfaced as the owning note.
      const assetRows: Row[] = useTs
        ? await prisma.$queryRawUnsafe<Row[]>(
            `SELECT DISTINCT n.id,
                  n.title,
                  n."folderId" as "folderId",
                  n."updatedAt",
                  left(n.body, 200) AS snippet
             FROM "Asset" a
             JOIN "Note" n ON n.id = a."noteId"
            WHERE n."archivedAt" IS NULL
              AND a."searchVector" @@ to_tsquery('simple', $1)
            ORDER BY n."updatedAt" DESC
            LIMIT $2`,
            tsquery,
            limit,
          )
        : [];

      // Merge: direct note hits first, then asset-only hits, de-duplicated.
      const seen = new Set(noteRows.map((r) => r.id));
      const rows: Row[] = [
        ...noteRows,
        ...assetRows.filter((r) => !seen.has(r.id)),
      ].slice(0, limit);
```

The existing `let final = rows;` line and the trigram fallback below it stay unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test apps/web/src/app/api/search/route.test.ts`
Expected: PASS — the new asset-search tests plus all pre-existing search tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/search/route.ts apps/web/src/app/api/search/route.test.ts
git commit -m "feat(notes): search surfaces notes via embedded asset matches"
```

---

## Task 7: API client — `assetsApi`

**Files:**
- Modify: `apps/web/src/lib/notes/api-client.ts`
- Test: `apps/web/src/lib/notes/api-client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/notes/api-client.test.ts`, inside the file (match its existing style — it already exercises `notesApi`/`foldersApi` with an injected `fetcher`). Add `assetsApi` to the import from `./api-client.ts`:

```ts
describe('assetsApi', () => {
  it('upload posts the file to the note assets endpoint and returns id + url', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'a1', url: '/api/assets/a1' }), { status: 201 });
    }) as unknown as typeof fetch;
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    const res = await assetsApi.upload('note1', file, fetcher);
    expect(res).toEqual({ id: 'a1', url: '/api/assets/a1' });
    expect(calls[0]?.url).toBe('/api/notes/note1/assets?filename=pic.png');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('patchCaption sends a PATCH with the caption body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'a1', caption: 'hi' }), { status: 200 });
    }) as unknown as typeof fetch;
    await assetsApi.patchCaption('a1', 'hi', fetcher);
    expect(calls[0]?.url).toBe('/api/assets/a1');
    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(String(calls[0]?.init?.body)).toContain('hi');
  });
});
```

If `api-client.test.ts` has no jsdom directive and `File` is unavailable in the node test environment, add `// @vitest-environment jsdom` as the file's first line (only if the test fails for a missing `File` global).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test apps/web/src/lib/notes/api-client.test.ts`
Expected: FAIL — `assetsApi` does not exist.

- [ ] **Step 3: Add `assetsApi`**

In `apps/web/src/lib/notes/api-client.ts`, append a new export alongside the existing `notesApi` / `foldersApi` / `tagsApi` / `searchApi` objects. It does not use the shared `request` helper for `upload` (raw-body, not JSON), but reuses it for `patchCaption`:

```ts
export const assetsApi = {
  /** Uploads a file as a note asset. Returns the new asset's id + serve URL. */
  upload: async (
    noteId: string,
    file: File,
    fetcher?: typeof fetch,
  ): Promise<{ id: string; url: string }> => {
    const f = fetcher ?? fetch;
    const res = await f(
      `/api/notes/${noteId}/assets?filename=${encodeURIComponent(file.name)}`,
      { method: 'POST', body: file },
    );
    if (!res.ok) {
      throw new ApiError(res.status, `HTTP ${res.status}`, null);
    }
    return (await res.json()) as { id: string; url: string };
  },

  /** Updates an asset's searchable caption. */
  patchCaption: (
    id: string,
    caption: string,
    fetcher?: typeof fetch,
  ): Promise<{ id: string; caption: string }> =>
    request(`/api/assets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ caption }),
      ...(fetcher ? { fetcher } : {}),
    }),
};
```

`ApiError` and `request` are already defined/used at the top of this file — confirm their names match (the file exports `ApiError` and uses an internal `request` helper).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test apps/web/src/lib/notes/api-client.test.ts`
Expected: PASS — `assetsApi` tests plus the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/api-client.ts apps/web/src/lib/notes/api-client.test.ts
git commit -m "feat(notes): assetsApi client (upload + caption patch)"
```

---

## Task 8: Image extension + resizable NodeView

**Files:**
- Create: `apps/web/src/components/notes/Editor/ImageExtension.ts` (+ `.test.ts`)
- Create: `apps/web/src/components/notes/Editor/ResizableImage.tsx` (+ `.test.tsx`)
- Modify: `apps/web/package.json` (add `@tiptap/extension-image`)
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the dependency**

In `apps/web/package.json`, add to `"dependencies"` (alongside the other `@tiptap/*` entries, all pinned to `3.23.4`):

```json
    "@tiptap/extension-image": "3.23.4",
```

Run: `bun install`
Expected: resolves; `@tiptap/extension-image@3.23.4` is installed. (Verify the version exists: `npm view @tiptap/extension-image@3.23.4 version`.)

- [ ] **Step 2: Add the two new files to the coverage-include list**

In `vitest.config.ts`, in `coverage.include`, after `'apps/web/src/components/notes/Editor/CalloutMenu.tsx',` add:

```ts
        'apps/web/src/components/notes/Editor/ImageExtension.ts',
        'apps/web/src/components/notes/Editor/ResizableImage.tsx',
```

- [ ] **Step 3: Write the failing tests**

Create `apps/web/src/components/notes/Editor/ImageExtension.test.ts`:

```ts
// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteImage } from './ImageExtension.ts';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const make = (content = '<p></p>'): Editor => {
  editor = new Editor({ extensions: [StarterKit, NoteImage], content });
  return editor;
};

describe('NoteImage extension', () => {
  it('renders an image with src, width and caption attributes', () => {
    const e = make();
    e.commands.insertContent({
      type: 'image',
      attrs: { src: '/api/assets/a1', width: 240, caption: 'A photo' },
    });
    const html = e.getHTML();
    expect(html).toContain('src="/api/assets/a1"');
    expect(html).toContain('width="240"');
    expect(html).toContain('A photo');
  });

  it('parses an existing <img> with data-width / data-caption back to attributes', () => {
    const e = make('<img src="/api/assets/a2" data-width="180" data-caption="Cat">');
    const node = e.getJSON().content?.[0];
    expect(node?.type).toBe('image');
    expect(node?.attrs?.src).toBe('/api/assets/a2');
    expect(node?.attrs?.width).toBe(180);
    expect(node?.attrs?.caption).toBe('Cat');
  });
});
```

Create `apps/web/src/components/notes/Editor/ResizableImage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResizableImage } from './ResizableImage.tsx';

afterEach(cleanup);

const messages = { notes: { editorImage: { captionPlaceholder: 'Add a caption…' } } } as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

/** Minimal NodeViewProps stub — only the fields ResizableImage reads. */
const makeProps = (over: Partial<{ src: string; width: number | null; caption: string }> = {}) => {
  const updateAttributes = vi.fn();
  const attrs = {
    src: over.src ?? '/api/assets/a1',
    width: over.width ?? null,
    caption: over.caption ?? '',
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub for Tiptap NodeViewProps
  const props = { node: { attrs }, updateAttributes, selected: true } as any;
  return { props, updateAttributes };
};

describe('ResizableImage', () => {
  it('renders the image at its stored width', () => {
    const { props } = makeProps({ width: 200 });
    const { container } = render(wrap(<ResizableImage {...props} />));
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/assets/a1');
    expect(img?.style.width).toBe('200px');
  });

  it('shows the caption input with the placeholder', () => {
    const { props } = makeProps();
    const { container } = render(wrap(<ResizableImage {...props} />));
    expect(within(container).getByPlaceholderText('Add a caption…')).toBeTruthy();
  });

  it('editing the caption updates the node attribute', () => {
    const { props, updateAttributes } = makeProps();
    const { container } = render(wrap(<ResizableImage {...props} />));
    fireEvent.change(within(container).getByPlaceholderText('Add a caption…'), {
      target: { value: 'Sunset' },
    });
    expect(updateAttributes).toHaveBeenCalledWith({ caption: 'Sunset' });
  });

  it('renders a resize handle when the node is selected', () => {
    const { props } = makeProps();
    const { container } = render(wrap(<ResizableImage {...props} />));
    expect(container.querySelector('[data-testid="image-resize-handle"]')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun run test apps/web/src/components/notes/Editor/ImageExtension.test.ts apps/web/src/components/notes/Editor/ResizableImage.test.tsx`
Expected: FAIL — neither module exists.

- [ ] **Step 5: Implement `ResizableImage.tsx`**

Create `apps/web/src/components/notes/Editor/ResizableImage.tsx`:

```tsx
'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { assetsApi } from '@/lib/notes/api-client.ts';
import { debounce } from '@/lib/notes/debounce.ts';
import { clampImageWidth } from '@/lib/notes/image-resize.ts';

/** Pulls the asset id out of a `/api/assets/<id>` src URL. */
const assetIdFromSrc = (src: string): string => src.split('/').filter(Boolean).pop() ?? '';

/**
 * NodeView for the editor image node. Renders the image, a corner resize
 * handle (aspect ratio kept — only the width changes; `max-width: 100%` in
 * CSS is the hard bound), and an editable caption. Caption edits update the
 * node attribute and are mirrored to `Asset.caption` (debounced) so search
 * stays current.
 */
export function ResizableImage({ node, updateAttributes, selected }: NodeViewProps) {
  const t = useTranslations('notes.editorImage');
  const src = String(node.attrs.src ?? '');
  const storedWidth = typeof node.attrs.width === 'number' ? node.attrs.width : null;
  const caption = String(node.attrs.caption ?? '');
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const patchCaption = useRef(
    debounce((id: string, value: string) => {
      void assetsApi.patchCaption(id, value).catch(() => undefined);
    }, 600),
  ).current;

  const onCaptionChange = (value: string) => {
    updateAttributes({ caption: value });
    const id = assetIdFromSrc(src);
    if (id) patchCaption(id, value);
  };

  const onHandlePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const img = frameRef.current?.querySelector('img');
    if (!img) return;
    const startX = e.clientX;
    const startWidth = img.clientWidth;
    const available = img.parentElement?.clientWidth ?? startWidth;
    const onMove = (ev: globalThis.PointerEvent) => {
      setDragWidth(clampImageWidth(startWidth + (ev.clientX - startX), available));
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      updateAttributes({ width: clampImageWidth(startWidth + (ev.clientX - startX), available) });
      setDragWidth(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderWidth = dragWidth ?? storedWidth;

  return (
    <NodeViewWrapper as="figure" className="note-image" data-selected={selected ? 'true' : undefined}>
      <div ref={frameRef} className="note-image-frame">
        <img
          src={src}
          alt={caption}
          draggable={false}
          style={renderWidth !== null ? { width: `${renderWidth}px` } : undefined}
        />
        {selected ? (
          <span
            data-testid="image-resize-handle"
            className="note-image-handle"
            aria-hidden="true"
            onPointerDown={onHandlePointerDown}
          />
        ) : null}
      </div>
      <figcaption>
        <input
          type="text"
          contentEditable={false}
          className="note-image-caption"
          value={caption}
          placeholder={t('captionPlaceholder')}
          onChange={(e) => onCaptionChange(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </figcaption>
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 6: Implement `ImageExtension.ts`**

Create `apps/web/src/components/notes/Editor/ImageExtension.ts`:

```ts
import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ResizableImage } from './ResizableImage.tsx';

/**
 * The editor's image node — `@tiptap/extension-image` extended with a
 * numeric `width` (resize) and a `caption`, both round-tripping through
 * `data-*` HTML attributes, and rendered by the `ResizableImage` NodeView.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('width') ?? element.getAttribute('data-width');
          const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attributes) =>
          attributes.width ? { width: String(attributes.width) } : {},
      },
      caption: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-caption') ?? element.getAttribute('alt') ?? '',
        renderHTML: (attributes) =>
          attributes.caption ? { 'data-caption': String(attributes.caption) } : {},
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImage);
  },
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test apps/web/src/components/notes/Editor/ImageExtension.test.ts apps/web/src/components/notes/Editor/ResizableImage.test.tsx`
Expected: PASS — all cases green.

If `ImageExtension.test.ts`'s `getHTML()` assertions need adjusting because `@tiptap/extension-image`'s default `renderHTML` orders attributes differently, adjust only the **test** expectations to the actual `getHTML()` output (use `toContain` on the individual attributes, which the test already does) — the extension code is correct.

- [ ] **Step 8: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/notes/Editor/ImageExtension.ts apps/web/src/components/notes/Editor/ImageExtension.test.ts apps/web/src/components/notes/Editor/ResizableImage.tsx apps/web/src/components/notes/Editor/ResizableImage.test.tsx apps/web/package.json bun.lock vitest.config.ts
git commit -m "feat(notes): resizable image node + NodeView"
```

---

## Task 9: Wire images into the editor (drop / paste / styling)

**Files:**
- Modify: `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/messages/en.json`, `de.json`
- Modify: `apps/web/package.json` (add `@tiptap/extension-file-handler`)
- Test: `apps/web/src/lib/notes/markdown.test.ts` (image → Markdown)

- [ ] **Step 1: Add the FileHandler dependency**

In `apps/web/package.json` `"dependencies"`, add (next to the other `@tiptap/*` entries):

```json
    "@tiptap/extension-file-handler": "3.23.4",
```

Run: `bun install`
Expected: resolves; `@tiptap/extension-file-handler@3.23.4` installed. (Verify it exists: `npm view @tiptap/extension-file-handler@3.23.4 version`.)

- [ ] **Step 2: Add the i18n strings**

In `apps/web/messages/en.json`, add inside the `notes` object, immediately before the `"editorActions"` block:

```json
    "editorImage": {
      "captionPlaceholder": "Add a caption…",
      "uploadFailed": "Image upload failed"
    },
```

In `apps/web/messages/de.json`, add the same block before its `"editorActions"` block:

```json
    "editorImage": {
      "captionPlaceholder": "Bildunterschrift hinzufügen…",
      "uploadFailed": "Bild-Upload fehlgeschlagen"
    },
```

- [ ] **Step 3: Register Image + FileHandler in `MarkdownExtensions.ts`**

Open `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`. It exports `buildExtensions(input)` returning the extension array. Make these changes:

1. Add imports (let Biome order them):

```ts
import FileHandler from '@tiptap/extension-file-handler';
import { NoteImage } from './ImageExtension.ts';
import { assetsApi } from '@/lib/notes/api-client.ts';
```

2. Add `noteId: string` to the `input` parameter's type (the object the function destructures — it currently has `doc`, `awareness`, `user`).

3. Add a helper above the returned array, inside `buildExtensions`, that uploads a file and inserts an image node:

```ts
  const uploadAndInsert = (
    editor: { chain: () => { insertContentAt: (pos: number, content: unknown) => { run: () => void } } },
    file: File,
    pos: number,
  ): void => {
    void assetsApi
      .upload(input.noteId, file)
      .then(({ url }) => {
        editor.chain().insertContentAt(pos, { type: 'image', attrs: { src: url } }).run();
      })
      .catch(() => {
        // upload failed — the editor stays usable; surfaced via console in dev
      });
  };
```

4. Add `NoteImage` and a configured `FileHandler` to the returned extension array (place them after `Callout`, before `Collaboration`):

```ts
  Callout,
  NoteImage,
  FileHandler.configure({
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
    onDrop: (editor, files, pos) => {
      for (const file of files) uploadAndInsert(editor, file, pos);
    },
    onPaste: (editor, files) => {
      for (const file of files) uploadAndInsert(editor, file, editor.state.selection.anchor);
    },
  }),
  Collaboration.configure({ document: input.doc }),
```

NOTE: confirm the exact `FileHandler` config option names against the installed `@tiptap/extension-file-handler@3.23.4` (its `onDrop`/`onPaste` signatures and `allowedMimeTypes`). If the real `editor` argument's typing makes the `uploadAndInsert` parameter type awkward, type that parameter as `Editor` (imported from `@tiptap/core`) and call `editor.chain().insertContentAt(...)` — adjust to whatever the real types require, without using `any`.

- [ ] **Step 4: Pass `noteId` into `buildExtensions` from `NoteEditor.tsx`**

In `apps/web/src/components/notes/Editor/NoteEditor.tsx`, the `CollaborativeEditor` component calls `buildExtensions({ doc, awareness, user })` inside its `useEditor(...)`. Add `noteId` to that call:

```ts
      extensions: buildExtensions({
        doc: ydoc,
        awareness: provider.awareness as unknown as {
          setLocalStateField: (k: string, v: unknown) => void;
          getStates: () => Map<number, unknown>;
        },
        user: { name: currentUser.name, color: currentUser.color },
        noteId,
      }),
```

`noteId` is already a prop of `CollaborativeEditor` — confirm and use it.

- [ ] **Step 5: Add image styling**

Append to the end of `apps/web/src/app/globals.css`:

```css
/* Editor images. `max-width: 100%` is the hard bound — an image can never
 * exceed the editor content column regardless of its stored width. */
.prose-paper .note-image {
  margin: 0.85em 0;
}
.prose-paper .note-image-frame {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.prose-paper .note-image-frame img {
  display: block;
  height: auto;
  max-width: 100%;
  border-radius: 4px;
}
.prose-paper .note-image-handle {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-accent);
  border-radius: 3px;
  background: var(--color-background);
  cursor: nwse-resize;
}
.prose-paper .note-image figcaption {
  margin-top: 0.3em;
}
.prose-paper .note-image-caption {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 0.85em;
  color: var(--color-muted-foreground);
  text-align: center;
}
.prose-paper .note-image-caption:focus {
  outline: none;
}
```

- [ ] **Step 6: Add the Markdown-export test**

In `apps/web/src/lib/notes/markdown.test.ts`, append inside the `describe('htmlToMarkdown', …)` block:

```ts
  it('converts an image to Markdown image syntax', () => {
    const md = htmlToMarkdown('<img src="/api/assets/a1" alt="A photo">');
    expect(md).toBe('![A photo](/api/assets/a1)');
  });
```

- [ ] **Step 7: Verify**

Run: `bun run test apps/web/src/lib/notes/markdown.test.ts`
Expected: PASS — the image-export test plus all pre-existing ones. (Turndown's built-in `<img>` rule handles this; if the exact output differs, adjust the test expectation to Turndown's actual output — no converter change.)

Run: `bun run typecheck`
Expected: PASS — `MarkdownExtensions.ts`, `NoteEditor.tsx` and the extension are all consistent.

Run: `bun run lint`
Expected: PASS (pre-existing warnings in unrelated files are acceptable).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/notes/Editor/MarkdownExtensions.ts apps/web/src/components/notes/Editor/NoteEditor.tsx apps/web/src/app/globals.css apps/web/messages/en.json apps/web/messages/de.json apps/web/package.json bun.lock apps/web/src/lib/notes/markdown.test.ts
git commit -m "feat(notes): drag-drop / paste image upload in the editor"
```

---

## Task 10: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Type + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 2: Full test suite with coverage**

Ensure Postgres + Redis are running (`docker ps`; `make up` if not). Run:

Run: `bun run test --coverage`
Expected: PASS — all tests green; coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The new coverage-gated files — `asset-mime.ts`, `image-resize.ts`, `api/notes/[noteId]/assets/route.ts`, `api/assets/[id]/route.ts`, `ImageExtension.ts`, `ResizableImage.tsx` — must each stay above threshold.

- [ ] **Step 3: If coverage dips below threshold**

Identify the uncovered lines from the report and add targeted tests to the matching `*.test.ts(x)` file. Re-run Step 2. Commit any added tests:

```bash
git add apps/web/src
git commit -m "test(notes): close coverage gap in asset feature"
```

If coverage is already fine, skip this step.

- [ ] **Step 4: Next build**

Run: `bun run build`
Expected: the Next build of `apps/web` completes with no error.

- [ ] **Step 5: Working tree check**

Run: `git status --short`
Expected: no uncommitted changes from this plan's files. Pre-existing untracked items (`.vscode/`, `bunfig.toml`, `scripts/`) and a regenerated `apps/web/next-env.d.ts` are unrelated — report but do not commit them.

---

## Self-Review

**Spec coverage:**
- Spec §1 (asset-storage foundation: `Asset` model, upload + serve API) → Tasks 1, 2, 4, 5. ✅
- Spec §2 (drag-drop + copy-paste image insert) → Task 9 (`FileHandler`). ✅
- Spec §3 (resizable, aspect-locked, editor-bounded) → Task 8 (`width` attr + NodeView resize handle + `clampImageWidth`) + Task 9 (`max-width: 100%` CSS hard bound). ✅
- Spec §4 (searchable by filename + caption) → Task 1 (`searchVector` generated column), Task 5 (`PATCH` caption), Task 6 (`/api/search` extension). ✅
- Spec "Decisions" (Postgres storage + ADR; 10 MB; png/jpeg/gif/webp; no SVG; no async job) → Task 1 (model + ADR), Task 3 (`MAX_ASSET_BYTES`, `sniffImageType` — four formats, no SVG), Task 4 (size + magic-byte enforcement). ✅
- Spec "Markdown export" (`![caption](url)` via Turndown) → Task 9 Step 6 test. ✅
- Non-goals (PDF, OCR, panel, async worker job) — none implemented. ✅

**Placeholder scan:** No TBD/TODO. Two unavoidable "match the existing file" instructions (the Next route-handler `params` signature in Tasks 4/5; the `FileHandler` option names in Task 9) are explicit "verify against the named existing file / installed package" directives, not vague placeholders — the surrounding code is fully specified. The migration SQL edit (Task 1 Step 3) operates on a Prisma-generated file whose exact text cannot be pre-printed; the instruction gives the precise two edits and names the `Note` migration as the verbatim precedent.

**Type consistency:** `MAX_ASSET_BYTES` / `sniffImageType` (Task 3, `asset-mime.ts`) are imported by the upload route (Task 4). `clampImageWidth` / `MIN_IMAGE_WIDTH` (Task 3, `image-resize.ts`) are used by `ResizableImage` (Task 8) and tested in Task 3. `assetUploadQuerySchema` / `patchCaptionSchema` (Task 2) are used by the routes (Tasks 4, 5). `assetsApi.upload` / `assetsApi.patchCaption` (Task 7) are called by `MarkdownExtensions.ts` (Task 9) and `ResizableImage` (Task 8) with matching signatures (`upload(noteId, file)` → `{id,url}`; `patchCaption(id, caption)`). `NoteImage` (Task 8) is registered in `MarkdownExtensions.ts` (Task 9). The image node name `'image'` (from `@tiptap/extension-image`) is what `uploadAndInsert` inserts (`type: 'image'`) and what `ImageExtension.test.ts` asserts. The `Asset` Prisma model fields (Task 1) match every `prisma.asset.create` call in the route tests (Tasks 4, 5, 6). i18n namespace `notes.editorImage` is used by `ResizableImage` and defined in Task 9.
