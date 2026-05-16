# Asset Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete an `Asset` row (Postgres `bytea` bytes + preview) when its image or PDF is removed from a note's editor content — via mark-and-sweep with a 24-hour grace period.

**Architecture:** A new nullable `Asset.unreferencedSince` column. The editor reports the asset IDs its document references on each note-body save; the web API stamps/un-stamps `Asset.unreferencedSince`. A periodic worker job hard-deletes assets stamped longer than 24h ago. The worker never inspects the editor schema (ADR 0022 preserved) — the sweep is pure timestamp logic.

**Tech Stack:** Prisma 7 / PostgreSQL, Next.js 16 route handlers, Tiptap 3.23.4, BullMQ 5.76.5, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-asset-cleanup-design.md` — read it before starting.

**Branch:** Work happens on `feat/notes-asset-cleanup` (already created off `feat/notes-doc-panel`). Do not switch branches.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/prisma/schema.prisma` | `Asset.unreferencedSince` + `@@index` |
| `packages/db/prisma/migrations/<new>/migration.sql` | additive — one nullable column + index |
| `docs/adr/0025-asset-cleanup.md` | ADR for the cleanup strategy |
| `docs/adr/README.md` | ADR index gains a line |
| `apps/web/src/lib/notes/doc-outline.ts` | **add** `referencedAssetIds(doc)` |
| `apps/web/src/lib/notes/doc-outline.test.ts` | extended |
| `apps/web/src/lib/api/schemas.ts` | `putNoteBodySchema` gains optional `assetIds` |
| `apps/web/src/app/api/notes/[id]/body/route.ts` | reconcile `Asset.unreferencedSince` on a successful save |
| `apps/web/src/app/api/notes/[id]/body/route.test.ts` | extended |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | the body-save computes + sends `assetIds` |
| `packages/jobs/src/queues.ts` | `assets.sweep` queue + `scheduleAssetsSweep` |
| `packages/jobs/src/index.ts` | re-export the new symbols |
| `packages/jobs/src/queues.test.ts` | extended |
| `apps/worker/src/processors/assets-sweep.ts` | **new** — the sweep processor |
| `apps/worker/src/processors/assets-sweep.test.ts` | **new** |
| `apps/worker/src/index.ts` | register the `assets.sweep` Worker + schedule the hourly repeatable |
| `vitest.config.ts` | coverage `include` addition (`assets-sweep.ts`) |

---

## Task 1: `Asset.unreferencedSince` column, migration, ADR

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<new>/migration.sql` (via Prisma)
- Modify: `packages/db/src/asset-schema.test.ts`
- Create: `docs/adr/0025-asset-cleanup.md`
- Modify: `docs/adr/README.md`

- [ ] **Step 1: Add the column to the Prisma model**

In `packages/db/prisma/schema.prisma`, in `model Asset`, add the field immediately after `pageCount` (before `createdAt`):

```prisma
  pageCount          Int?
  unreferencedSince  DateTime?
  createdAt          DateTime  @default(now())
```

And add an index — in the model's index block (where `@@index([noteId])` is):

```prisma
  @@index([noteId])
  @@index([unreferencedSince])
```

- [ ] **Step 2: Generate the migration**

Run: `cd packages/db && bunx prisma migrate dev --create-only --name add_asset_unreferenced_since`
Expected: a new `packages/db/prisma/migrations/<timestamp>_add_asset_unreferenced_since/migration.sql`.

- [ ] **Step 3: Verify the migration is purely additive**

Open the generated `migration.sql`. It MUST contain only:

```sql
ALTER TABLE "Asset" ADD COLUMN "unreferencedSince" TIMESTAMP(3);
CREATE INDEX "Asset_unreferencedSince_idx" ON "Asset"("unreferencedSince");
```

If Prisma added unrelated `DROP INDEX` / drift statements (it sometimes emits drift artifacts against the generated `searchVector` columns), DELETE those lines so the migration is exactly the two statements above.

- [ ] **Step 4: Apply the migration and regenerate the client**

Run: `cd packages/db && bunx prisma migrate dev --name add_asset_unreferenced_since`
Expected: applies cleanly; `prisma generate` runs; the `Asset` type now has `unreferencedSince`.

- [ ] **Step 5: Write the round-trip test**

Append to `packages/db/src/asset-schema.test.ts`, inside the existing `describe` block, reusing the file's existing seeding pattern (open the file; match how its other cases create the user + note + asset):

```ts
  it('round-trips the unreferencedSince column', async () => {
    const { note, user } = await seedNoteAndUser();
    const when = new Date('2026-05-16T10:00:00.000Z');
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'x.png',
        byteSize: 8,
        data: Buffer.from('%PNG'),
        unreferencedSince: when,
      },
    });
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince?.getTime()).toBe(when.getTime());
  });
```

`seedNoteAndUser` is illustrative — use the file's actual helper or inline seeding (match the existing cases). A fresh `Asset` created without `unreferencedSince` should have it `null` — assert that too if the file's style invites it.

- [ ] **Step 6: Run the test**

Run: `bun run vitest packages/db/src/asset-schema.test.ts` (Postgres up — `make up` from the repo root if `docker ps` shows it is not)
Expected: PASS.

- [ ] **Step 7: Write the ADR**

Create `docs/adr/0025-asset-cleanup.md`. FIRST open `docs/adr/0024-pdf-processing-library.md` and copy its exact heading / status-line / section layout. Content (conform headings to whatever 0024 uses):

```markdown
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
- The **editor client** reports the asset IDs its document references with
  each note-body save; `PUT /api/notes/[id]/body` reconciles
  `unreferencedSince` for that note (stamp newly-unreferenced assets,
  un-stamp re-referenced ones), scoped to the saved note.
- A periodic worker job (`assets.sweep`, hourly) hard-deletes assets whose
  `unreferencedSince` is older than 24 hours.

The reconcile is client-reported — **not** done in the worker — because
ADR 0022 deliberately keeps the editor's ProseMirror schema out of the
worker (its snapshot job treats the Yjs document as opaque CRDT bytes).
Having the worker walk the document for asset node types would breach that
split. The web app already owns the editor schema and enumerates a note's
assets (for the document panel), so it is the natural place for the mark.
The sweep stays in the worker because it is pure timestamp logic with no
schema knowledge.

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
- Cross-note asset reuse remains unsupported (a pre-existing A non-goal):
  each asset is reconciled against its own note only.

## References

- Spec: `docs/superpowers/specs/2026-05-16-asset-cleanup-design.md`
- ADR 0022 — yjs / y-websocket in the worker
- ADR 0023 — asset storage in Postgres
```

- [ ] **Step 8: Register the ADR in the index**

In `docs/adr/README.md`, add an ADR 0025 entry following the exact format of the existing rows (the 0024 line is the precedent).

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/asset-schema.test.ts docs/adr/0025-asset-cleanup.md docs/adr/README.md
git commit -m "feat(notes): Asset.unreferencedSince column + cleanup ADR"
```

---

## Task 2: `referencedAssetIds` helper

**Files:**
- Modify: `apps/web/src/lib/notes/doc-outline.ts`
- Modify: `apps/web/src/lib/notes/doc-outline.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/notes/doc-outline.test.ts`. Add `referencedAssetIds` to the existing import from `./doc-outline.ts`, and append a `describe` block. The file already builds headless editors with `StarterKit` / `Link` / `NoteImage` / `PdfChipNode` and has a `makeDoc`-style helper — match its style:

```ts
describe('referencedAssetIds', () => {
  it('returns the asset ids of image and pdfChip nodes', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
      content: {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: '/api/assets/img-1', caption: '' } },
          {
            type: 'pdfChip',
            attrs: { assetId: 'pdf-1', src: '/api/assets/pdf-1', filename: 'r.pdf', byteSize: 1 },
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] },
        ],
      },
    });
    expect(referencedAssetIds(editor.state.doc).sort()).toEqual(['img-1', 'pdf-1']);
  });

  it('returns an empty array for a document with no assets', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(referencedAssetIds(editor.state.doc)).toEqual([]);
  });

  it('ignores an image whose src is not an /api/assets/<id> URL', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'https://example.com/x.png', caption: '' } }],
      },
    });
    expect(referencedAssetIds(editor.state.doc)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/lib/notes/doc-outline.test.ts`
Expected: FAIL — `referencedAssetIds` not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/notes/doc-outline.ts`, append:

```ts
/** The asset id embedded in an `/api/assets/<id>` URL, or `''` if absent. */
const assetIdFromSrc = (src: string): string => {
  const match = src.match(/\/api\/assets\/([^/?#]+)/);
  return match ? match[1] : '';
};

/**
 * The distinct asset IDs the document references — from `image` node `src`
 * URLs and `pdfChip` node `assetId` attributes. Used by the editor to report
 * referenced assets on save (sub-project D's cleanup reconcile).
 */
export const referencedAssetIds = (doc: ProseMirrorNode): string[] => {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'image') {
      const id = assetIdFromSrc(String(node.attrs.src ?? ''));
      if (id !== '') ids.add(id);
    } else if (node.type.name === 'pdfChip') {
      const id = String(node.attrs.assetId ?? '');
      if (id !== '') ids.add(id);
    }
    return true;
  });
  return [...ids];
};
```

(`ProseMirrorNode` is the type already used by `deriveDocItems` in this file — reuse the same import / type alias it already has; do not introduce a new one.)

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/web/src/lib/notes/doc-outline.test.ts`
Expected: PASS — old and new cases.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/notes/doc-outline.ts apps/web/src/lib/notes/doc-outline.test.ts
git commit -m "feat(notes): referencedAssetIds — asset ids a document references"
```

---

## Task 3: Reconcile `unreferencedSince` on note-body save

**Files:**
- Modify: `apps/web/src/lib/api/schemas.ts`
- Modify: `apps/web/src/app/api/notes/[id]/body/route.ts`
- Modify: `apps/web/src/app/api/notes/[id]/body/route.test.ts`
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`

- [ ] **Step 1: Add `assetIds` to the body-save schema**

In `apps/web/src/lib/api/schemas.ts`, extend `putNoteBodySchema`:

```ts
export const putNoteBodySchema = z.object({
  body: z.string().max(BODY_MAX),
  // Optimistic-concurrency token from the last GET. Server rejects with 409
  // if the note has changed since.
  baseUpdatedAt: z.iso.datetime(),
  // The asset ids the editor's current document references. Optional — when
  // omitted (e.g. import/automation callers), the body route skips the
  // asset-cleanup reconcile entirely rather than treating the note as
  // asset-less.
  assetIds: z.array(z.string()).optional(),
});
```

(`PutNoteBodyInput = z.infer<…>` then has `assetIds?: string[]` automatically.)

- [ ] **Step 2: Write the failing route tests**

Open `apps/web/src/app/api/notes/[id]/body/route.test.ts`. Append cases inside the existing `describe` for the PUT route. Reuse the file's existing helpers (read it — it has auth mocking, `makeTestUser`/`authedAs` or similar, and seeds notes; match exactly). A helper to seed an asset for a note will be needed — create it inline following `asset-schema.test.ts`'s shape. The tests:

```ts
  it('marks an asset the save no longer references', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'recon-1', authorId: user.id } });
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id, authorId: user.id, kind: 'IMAGE', contentType: 'image/png',
        filename: 'a.png', byteSize: 8, data: Buffer.from('%PNG'),
      },
    });
    const res = await PUT(
      new Request(`http://localhost/api/notes/${note.id}/body`, {
        method: 'PUT',
        body: JSON.stringify({
          body: 'text', baseUpdatedAt: note.updatedAt.toISOString(), assetIds: [],
        }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    expect(res.status).toBe(200);
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince).not.toBeNull();
  });

  it('un-marks an asset the save references again', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'recon-2', authorId: user.id } });
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id, authorId: user.id, kind: 'IMAGE', contentType: 'image/png',
        filename: 'b.png', byteSize: 8, data: Buffer.from('%PNG'),
        unreferencedSince: new Date('2026-05-01T00:00:00.000Z'),
      },
    });
    const res = await PUT(
      new Request(`http://localhost/api/notes/${note.id}/body`, {
        method: 'PUT',
        body: JSON.stringify({
          body: 't', baseUpdatedAt: note.updatedAt.toISOString(), assetIds: [asset.id],
        }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    expect(res.status).toBe(200);
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince).toBeNull();
  });

  it('keeps the original timestamp of an already-marked asset', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'recon-3', authorId: user.id } });
    const stamp = new Date('2026-05-02T00:00:00.000Z');
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id, authorId: user.id, kind: 'IMAGE', contentType: 'image/png',
        filename: 'c.png', byteSize: 8, data: Buffer.from('%PNG'), unreferencedSince: stamp,
      },
    });
    await PUT(
      new Request(`http://localhost/api/notes/${note.id}/body`, {
        method: 'PUT',
        body: JSON.stringify({ body: 't', baseUpdatedAt: note.updatedAt.toISOString(), assetIds: [] }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince?.getTime()).toBe(stamp.getTime());
  });

  it('does not reconcile when assetIds is omitted', async () => {
    const { user } = await makeTestUser();
    authedAs(mockedAuth, user);
    const note = await prisma.note.create({ data: { title: 'recon-4', authorId: user.id } });
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id, authorId: user.id, kind: 'IMAGE', contentType: 'image/png',
        filename: 'd.png', byteSize: 8, data: Buffer.from('%PNG'),
      },
    });
    await PUT(
      new Request(`http://localhost/api/notes/${note.id}/body`, {
        method: 'PUT',
        body: JSON.stringify({ body: 't', baseUpdatedAt: note.updatedAt.toISOString() }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince).toBeNull();
  });
```

NOTE: match the file's actual helper names and auth-mock setup. If a `409` test already exists, optionally add an assertion that a conflicting save does not reconcile — but the four cases above are the requirement.

- [ ] **Step 3: Run to verify failure**

Run: `bun run vitest "apps/web/src/app/api/notes/[id]/body/route.test.ts"`
Expected: FAIL — the route does not yet reconcile.

- [ ] **Step 4: Implement the reconcile in the route**

Edit `apps/web/src/app/api/notes/[id]/body/route.ts`. After the successful `prisma.note.update` (the `const updated = …` block) and BEFORE `return jsonOk(...)`, add the reconcile. The whole block:

```ts
      const updated = await prisma.note.update({
        where: { id },
        data: { body, lastEditorId: user.id },
        select: { id: true, updatedAt: true },
      });

      // Asset cleanup reconcile (sub-project D): stamp/un-stamp this note's
      // assets against the ids the editor reports. Skipped when assetIds is
      // omitted (non-editor callers) so they never mark a note asset-less.
      if (parsed.data.assetIds !== undefined) {
        const assetIds = parsed.data.assetIds;
        await prisma.asset.updateMany({
          where: { noteId: id, id: { in: assetIds }, unreferencedSince: { not: null } },
          data: { unreferencedSince: null },
        });
        await prisma.asset.updateMany({
          where: { noteId: id, id: { notIn: assetIds }, unreferencedSince: null },
          data: { unreferencedSince: new Date() },
        });
      }

      return jsonOk({ id: updated.id, updatedAt: updated.updatedAt.toISOString() });
```

The `409` conflict path returns earlier — it never reaches the reconcile, so a conflicting save correctly does not reconcile. The `updateMany`s are scoped by `noteId`, so the client's `assetIds` can only affect this note's assets. (Prisma treats `in: []` as "match none" and `notIn: []` as "match all" — so an explicit empty `assetIds` correctly marks every still-referenced asset of the note.)

- [ ] **Step 5: Run the route tests**

Run: `bun run vitest "apps/web/src/app/api/notes/[id]/body/route.test.ts"`
Expected: PASS — old and new cases.

- [ ] **Step 6: Send `assetIds` from the editor**

Edit `apps/web/src/components/notes/Editor/NoteEditor.tsx`. In `CollaborativeEditor`, the autosave effect calls `notesApi.putBody(noteId, { body: text, baseUpdatedAt })`. Add the asset ids:

1. Add the import (let biome order it):

```ts
import { referencedAssetIds } from '@/lib/notes/doc-outline.ts';
```

2. In the save block, compute and pass `assetIds`:

```ts
        const text = editor.getText();
        const assetIds = referencedAssetIds(editor.state.doc);
        const res = await notesApi.putBody(noteId, { body: text, baseUpdatedAt, assetIds });
```

(`notesApi.putBody` already forwards the whole input object as the request body — no change needed in `api-client.ts`; `PutNoteBodyInput` now permits `assetIds`.)

- [ ] **Step 7: Typecheck + lint**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun run lint`
Expected: PASS (pre-existing unrelated warnings acceptable).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api/schemas.ts "apps/web/src/app/api/notes/[id]/body/route.ts" "apps/web/src/app/api/notes/[id]/body/route.test.ts" apps/web/src/components/notes/Editor/NoteEditor.tsx
git commit -m "feat(notes): reconcile Asset.unreferencedSince on note save"
```

---

## Task 4: `assets.sweep` queue + repeatable scheduler

**Files:**
- Modify: `packages/jobs/src/queues.ts`
- Modify: `packages/jobs/src/index.ts`
- Modify: `packages/jobs/src/queues.test.ts`

- [ ] **Step 1: Add the queue, schema, producer, and scheduler**

In `packages/jobs/src/queues.ts`:

1. Add `assetsSweep` to the `QUEUES` const:

```ts
export const QUEUES = {
  demo: 'demo',
  notesSnapshot: 'notes.snapshot',
  pdfExtract: 'pdf.extract',
  assetsSweep: 'assets.sweep',
} as const;
```

2. After the `pdf.extract` schema block, add the `assets.sweep` schema (the job carries no data — the sweep scans the whole table):

```ts
// ── assets.sweep queue ──────────────────────────────────────────────────────
// A periodic sweep that hard-deletes assets unreferenced past the grace
// period. Scheduled as a repeatable job (see scheduleAssetsSweep); the job
// itself carries no payload.
export const AssetsSweepJobSchema = z.object({});
export type AssetsSweepPayload = z.infer<typeof AssetsSweepJobSchema>;
```

3. After the `pdf.extract` producer block, add the `assets.sweep` queue + the repeatable scheduler. Mirror the lazy-singleton pattern of the other queues; reuse the existing `defaultJobOpts`:

```ts
// ── assets.sweep scheduler ──────────────────────────────────────────────────
let assetsSweepQueue: Queue<AssetsSweepPayload> | undefined;
const getAssetsSweepQueue = (): Queue<AssetsSweepPayload> => {
  if (assetsSweepQueue) return assetsSweepQueue;
  assetsSweepQueue = new Queue<AssetsSweepPayload>(QUEUES.assetsSweep, {
    connection: getRedis(),
    defaultJobOptions: defaultJobOpts,
  });
  return assetsSweepQueue;
};

/** One hour, in milliseconds — the sweep cadence. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Register the hourly `assets.sweep` repeatable job. Idempotent — call once
 * from the worker entry on startup. The grace period itself lives in the
 * processor, not here.
 */
export const scheduleAssetsSweep = async (): Promise<void> => {
  await getAssetsSweepQueue().upsertJobScheduler(
    'assets-sweep-hourly',
    { every: SWEEP_INTERVAL_MS },
    { name: 'sweep' },
  );
};
```

4. Extend `getQueueForBullBoard` with the new arm:

```ts
  if (name === QUEUES.assetsSweep) return getAssetsSweepQueue() as Queue;
```

NOTE: `upsertJobScheduler` is BullMQ's repeatable-job API. Confirm it exists in the installed `bullmq` (the worker pins `5.76.5`). If that version predates `upsertJobScheduler`, use the older repeatable form — `getAssetsSweepQueue().add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'assets-sweep-hourly' })` — instead. Use whichever the installed version supports; keep it idempotent.

- [ ] **Step 2: Re-export from the package index**

In `packages/jobs/src/index.ts`, add `AssetsSweepJobSchema`, the type `AssetsSweepPayload`, and `scheduleAssetsSweep` to the export block, preserving the file's alphabetical ordering.

- [ ] **Step 3: Write the schema test**

Append to `packages/jobs/src/queues.test.ts`:

```ts
describe('AssetsSweepJobSchema', () => {
  it('accepts an empty payload', () => {
    expect(AssetsSweepJobSchema.parse({})).toEqual({});
  });
});
```

Add `AssetsSweepJobSchema` to the file's import from `./queues.ts`.

- [ ] **Step 4: Run the test + typecheck**

Run: `bun run vitest packages/jobs/src/queues.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/queues.ts packages/jobs/src/index.ts packages/jobs/src/queues.test.ts
git commit -m "feat(jobs): assets.sweep queue + hourly repeatable scheduler"
```

---

## Task 5: `assets.sweep` processor + worker registration

**Files:**
- Create: `apps/worker/src/processors/assets-sweep.ts`
- Create: `apps/worker/src/processors/assets-sweep.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/processors/assets-sweep.test.ts` — an integration test against a real Postgres, following the `pdf-extract.test.ts` pattern (open it — same `TEST_PREFIX` cleanup + `seed` shape):

```ts
import { prisma } from '@app/db';
import type { Job } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processAssetsSweep } from './assets-sweep.ts';

const TEST_PREFIX = 'assets-sweep-';

const cleanup = async () => {
  await prisma.asset.deleteMany({
    where: { note: { author: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.note.deleteMany({ where: { author: { email: { startsWith: TEST_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
};

const seedAsset = async (unreferencedSince: Date | null) => {
  const user = await prisma.user.create({
    data: {
      keycloakSub: `${TEST_PREFIX}sub-${crypto.randomUUID()}`,
      email: `${TEST_PREFIX}${crypto.randomUUID()}@example.invalid`,
      displayName: 'Sweep',
      roles: ['user'],
    },
  });
  const note = await prisma.note.create({ data: { title: 'sweep-note', authorId: user.id } });
  return prisma.asset.create({
    data: {
      noteId: note.id, authorId: user.id, kind: 'IMAGE', contentType: 'image/png',
      filename: 'a.png', byteSize: 8, data: Buffer.from('%PNG'), unreferencedSince,
    },
  });
};

const fakeJob = (): Job =>
  ({ id: crypto.randomUUID(), data: {}, log: async () => undefined }) as unknown as Job;

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('processAssetsSweep', () => {
  it('deletes assets unreferenced longer than the grace period', async () => {
    const old = await seedAsset(new Date(Date.now() - 25 * 60 * 60 * 1000));
    await processAssetsSweep(fakeJob());
    expect(await prisma.asset.findUnique({ where: { id: old.id } })).toBeNull();
  });

  it('keeps assets unreferenced within the grace period', async () => {
    const recent = await seedAsset(new Date(Date.now() - 60 * 1000));
    await processAssetsSweep(fakeJob());
    expect(await prisma.asset.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  it('keeps referenced assets (unreferencedSince null)', async () => {
    const live = await seedAsset(null);
    await processAssetsSweep(fakeJob());
    expect(await prisma.asset.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/worker/src/processors/assets-sweep.test.ts`
Expected: FAIL — `processAssetsSweep` not defined. (Postgres up — `make up` if needed.)

- [ ] **Step 3: Implement the processor**

Create `apps/worker/src/processors/assets-sweep.ts`:

```ts
import { prisma } from '@app/db';
import type { AssetsSweepPayload } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import type { Job } from 'bullmq';

const log = createLogger({ component: 'processor.assets.sweep' });

/** Grace period — assets unreferenced longer than this are hard-deleted. */
const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Hard-deletes `Asset` rows that have stayed unreferenced past the 24-hour
 * grace period (their `unreferencedSince` was stamped by the note-body-save
 * reconcile and never cleared). Pure timestamp logic — no editor-schema
 * knowledge, so it stays clear of the ADR-0022 worker/schema split.
 * Runs as the hourly `assets.sweep` repeatable job.
 */
export const processAssetsSweep = async (job: Job<AssetsSweepPayload>): Promise<void> =>
  withSpan('assets.sweep', { 'job.id': job.id ?? '' }, async () => {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const { count } = await prisma.asset.deleteMany({
      where: { unreferencedSince: { lt: cutoff } },
    });
    await job.log(`assets.sweep deleted=${count} cutoff=${cutoff.toISOString()}`);
    if (count > 0) log.info({ count }, 'swept unreferenced assets');
  });
```

NOTE: the spec mentions a summary audit-log entry. Open `packages/db/src/audit.ts` (the `recordAudit` helper) — if it accepts a system / null actor cleanly, add one `recordAudit({ action: 'assets.swept', … metadata: { count } })` call when `count > 0`. If `recordAudit` requires a real user `actorId`, do NOT invent one — the `log.info` above is the audit trail for this system job; leave it at that. Use your judgement against the actual helper signature.

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/worker/src/processors/assets-sweep.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Register the Worker + schedule the repeatable**

In `apps/worker/src/index.ts`:

1. Add the imports — `processAssetsSweep` next to the other processors, and `scheduleAssetsSweep` from `@app/jobs`:

```ts
import { processAssetsSweep } from './processors/assets-sweep.ts';
```

Extend the existing `@app/jobs` import to also bring in `scheduleAssetsSweep`.

2. After the `pdfExtractWorker` block (before the HTTP-server section), register the worker:

```ts
const assetsSweepWorker = new Worker(QUEUES.assetsSweep, processAssetsSweep, {
  connection: getRedis(),
  concurrency: 1,
});

assetsSweepWorker.on('failed', (job, err) => {
  log.error(
    { jobId: job?.id, err: err.message, queue: QUEUES.assetsSweep },
    'assets sweep job failed',
  );
});

assetsSweepWorker.on('error', (err) => {
  log.error({ err: err.message, queue: QUEUES.assetsSweep }, 'assets sweep worker error');
});
```

3. Schedule the hourly repeatable on startup. After the workers are constructed (a good spot is just before the `log.info({ … }, 'worker started')` line), add:

```ts
void scheduleAssetsSweep().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : err }, 'failed to schedule assets sweep');
});
```

4. In the `shutdown` function, add `assetsSweepWorker` to the drain sequence, after `pdfExtractWorker`:

```ts
    await pdfExtractWorker.close();
    await assetsSweepWorker.close();
```

- [ ] **Step 6: Add the processor to the coverage gate**

In `vitest.config.ts`, in `test.coverage.include`, add the processor next to `pdf-extract.ts` / `pdf-render.ts`:

```ts
        'apps/worker/src/processors/assets-sweep.ts',
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS (all packages, incl. `apps/worker`).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/processors/assets-sweep.ts apps/worker/src/processors/assets-sweep.test.ts apps/worker/src/index.ts vitest.config.ts
git commit -m "feat(worker): assets.sweep processor + hourly schedule"
```

---

## Task 6: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Type + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS (pre-existing unrelated warnings acceptable; any *error* is a real failure).

- [ ] **Step 2: Full test suite with coverage**

Ensure Postgres + Redis are running (`docker ps`; `make up` if not). Run:

Run: `bun run test --coverage`
Expected: PASS — all tests green; coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The new / changed coverage-gated files — `doc-outline.ts`, `assets-sweep.ts`, the body route, `schemas.ts` — must each stay above threshold.

- [ ] **Step 3: If coverage dips below threshold**

Identify the uncovered lines and add targeted tests to the matching `*.test.ts(x)` file. Re-run Step 2. Commit any added tests:

```bash
git add apps/web/src apps/worker/src packages
git commit -m "test(notes): close coverage gap in asset cleanup"
```

If coverage already passes, skip this step.

- [ ] **Step 4: Next build**

Run: `bun run build`
Expected: the `@app/web` Next build completes with no error. (The worker's pre-existing `bun build` multi-entry-output CLI error predates this work — unrelated; report it but do not act on it.)

- [ ] **Step 5: Working tree check**

Run: `git status --short`
Expected: no uncommitted changes from this plan's files. Pre-existing untracked items (`.vscode/`, `bunfig.toml`, `scripts/`) and a regenerated `apps/web/next-env.d.ts` are unrelated — report but do not commit them. If `.gitignore` shows as modified, inspect it: a stray `/docs` entry has appeared once before in this work — if present, discard that change (`git checkout -- .gitignore`); `docs/` is a tracked directory.

---

## Self-Review

**Spec coverage:**
- Spec §1 (`Asset.unreferencedSince` column + index) → Task 1. ✅
- Spec §2 (the mark — client reports `assetIds`, the route reconciles) → Task 2 (`referencedAssetIds`) + Task 3 (`assetIds` schema field, route reconcile, editor sends it). ✅
- Spec §3 (the sweep — hourly repeatable, 24h grace, hard delete) → Task 4 (queue + repeatable scheduler) + Task 5 (processor + worker registration). ✅
- Spec §4 (safety — undo / cut-paste / upload race / collab) → emergent from the mark-and-sweep + the 24h grace in Task 5's `GRACE_MS`; the route's scoped `updateMany`s (Task 3) ensure re-referenced assets are un-marked. ✅
- Spec "ADR" → Task 1 Step 7. ✅
- Testing section → every task is TDD; the new processor is added to the coverage gate in Task 5. ✅

**Placeholder scan:** No TBD/TODO. The `<new>` migration-folder name (Task 1) is a Prisma-generated timestamp; the steps name the `--name` flag and the exact SQL to expect. The "match the file's existing helpers/seeding" notes (Tasks 1, 3, 5) and the "verify `upsertJobScheduler` against the installed bullmq" note (Task 4) and the "check `recordAudit`'s signature" note (Task 5) are explicit, bounded verification directives against named files/packages — the pattern A/B/C's plans used and their reviews accepted — not vague placeholders.

**Type consistency:** `Asset.unreferencedSince` (Task 1) is read/written by the route reconcile (Task 3) and the sweep processor (Task 5). `referencedAssetIds(doc)` (Task 2) returns `string[]`, consumed by `NoteEditor.tsx` (Task 3) and matching the `assetIds: string[]` schema field (Task 3). `PutNoteBodyInput` gains `assetIds?: string[]` from the Zod schema and flows through the unchanged `notesApi.putBody`. `QUEUES.assetsSweep` / `AssetsSweepPayload` / `scheduleAssetsSweep` (Task 4) are consumed by the worker entry and the processor (Task 5). `processAssetsSweep` is typed `Job<AssetsSweepPayload>`. The `assets.sweep` string is the queue name throughout.
