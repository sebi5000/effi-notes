# QA Code Quality and Efficiency Review

**Date:** 2026-05-20  
**Reviewer perspective:** Software QA focused on release readiness, maintainability, correctness, and runtime efficiency.  
**Scope:** Current `effi-notes` repository, with emphasis on the notes app (`apps/web`), worker (`apps/worker`), shared persistence/auth/jobs packages, CI/build posture, and test ergonomics.

## Executive Summary

The repository is in a strong state for a feature-heavy notes application: the domain model is documented with ADRs, the authorization rules are centralized, route handlers consistently validate external input with Zod, and the test suite is broad. With local Postgres and Redis available, the Vitest suite passes: **103 test files, 881 tests**.

The main risks are not broad architectural failures; they are sharper release and editor-save correctness issues:

1. The advertised root build command currently fails because the worker build script is incompatible with Bun's output behavior.
2. The editor body-save path uses `Note.updatedAt` as a concurrency token even though title updates and Yjs snapshots also mutate `updatedAt`, so normal editing can create false 409 conflicts.
3. The save-state reducer can mark the editor as saved after a newer edit occurred during an in-flight save.
4. The direct folder PATCH API can create folder cycles; only the reorder endpoint has the full descendant guard.
5. Several accepted "small app" shortcuts are reasonable today but should be revisited before larger deployments: all-folder authorization scope expansion, duplicate client fetches, raw SQL search helpers, DB-backed binary assets, and build-time external font fetching.

## Verification Results

Commands run from the repository root:

- `bun run typecheck` - passed across all packages.
- `bun run lint` - passed, with 2 Biome warnings and 9 informational findings.
- `bun run lint:next` - passed, with 1 warning in `apps/web/src/lib/notes/save-state.ts`.
- `bun run format:check` - passed.
- `bun run test` - passed with local Postgres and Redis access: 103 files, 881 tests.
- `bun --filter @app/web build` - passed when network egress was allowed for Google Fonts.
- `bun --filter @app/worker build` - failed with `error: cannot write multiple output files without an output directory`.
- `bun run build` - failed because it runs every workspace build, including the failing worker build.

Note: the sandboxed test run initially failed because localhost Postgres/Redis connections were blocked. With local service access, tests passed. CI already models the needed services in `.github/workflows/ci.yml:101-156`.

## Strengths

- Authorization is centralized in `apps/web/src/lib/notes/access.ts`, and the ADRs explain the ownership/share model clearly.
- API route handlers generally follow the same shape: authenticate, parse with Zod, authorize, perform the Prisma operation, and return a standard JSON envelope.
- The test suite is unusually broad for a notes app. It covers API routes, access rules, editor helpers, workers, Yjs persistence, public links, and schema behavior.
- The public-link rendering path is deliberately account-less, rate-limited, no-indexed, and backed by token-scoped asset URLs.
- The worker responsibilities are separated by processor, and queue payload schemas live in the shared jobs package.
- Documentation is strong: architecture, operations, customer install docs, ADRs, specs, and plans are all present.

## Findings

### P0 - Root Build Command Fails

**Evidence**

- Root `package.json` advertises `"build": "bun --filter '*' build"` at `package.json:18`.
- The worker build script is `"bun build src/index.ts --target=bun --outfile=dist/worker.js"` at `apps/worker/package.json:8`.
- Running `bun --filter @app/worker build` fails with `error: cannot write multiple output files without an output directory`.
- The worker Dockerfile does not use that build output; it runs TypeScript source directly with `CMD ["bun", "apps/worker/src/index.ts"]` at `apps/worker/Dockerfile:41`.

**Impact**

`make build` / `bun run build` is not a reliable release-readiness command. The Docker path may still work, but the repository has two competing worker build stories: a broken package build script and a Docker runtime that bypasses it.

**Recommendation**

Choose one worker production model and align scripts, Docker, README, and CI:

- If the worker should be bundled, change the script to use an output directory, for example `bun build src/index.ts --target=bun --outdir=dist`, and update `start` to the produced entry.
- If the worker intentionally runs TS source under Bun, remove or replace the misleading package build script and update the root build to only build artifacts that are actually used.
- Add a CI job for the root `make build` command if it remains documented as a supported workflow.

### P1 - `updatedAt` Is Too Broad for Body-Save Concurrency

**Evidence**

- The body-save schema calls `baseUpdatedAt` an optimistic concurrency token at `apps/web/src/lib/api/schemas.ts:44-48`.
- `PUT /api/notes/[id]/body` compares that token to the note's global `updatedAt` at `apps/web/src/app/api/notes/[id]/body/route.ts:45-61`.
- The editor sends `baseUpdatedAt` during the 5-second body-save interval at `apps/web/src/components/notes/Editor/NoteEditor.tsx:246-266`.
- Auto-title also patches the note every 2 seconds when needed at `apps/web/src/components/notes/Editor/NoteEditor.tsx:268-285`.
- Worker Yjs snapshots update the same `Note` row at `apps/worker/src/yjs/persistence.ts:60-66`.

**Impact**

Normal single-user editing can produce false conflicts:

- Auto-title changes `title`, which updates `Note.updatedAt`; the next body save still holds the old `baseUpdatedAt`.
- The worker snapshots `yjsState`, which also updates `Note.updatedAt`; the next body save can conflict even though it is the same live editor session.

That makes the save indicator and body mirror fragile. It can also leave search/snippets/assets reconciliation stale if the editor stops retrying successfully.

**Recommendation**

Use a content-specific concurrency token:

- Add `bodyUpdatedAt`, `bodyVersion`, or a narrow `contentVersion` column and compare against that in the body route.
- Do not let title-only patches or Yjs snapshot persistence invalidate the body-save token.
- Alternatively, return a new token from all note mutations that can affect the client save base, but a body-specific token is cleaner.
- Add integration tests for "auto-title patch before body save" and "worker snapshot before body save" to prevent regression.

### P1 - Save State Can Acknowledge an Older Save After a Newer Edit

**Evidence**

- The editor dispatches `save-start`, sends the body, then always dispatches `save-ok` on success at `apps/web/src/components/notes/Editor/NoteEditor.tsx:248-257`.
- The reducer maps any `save-ok` to `saved` at `apps/web/src/lib/notes/save-state.ts:39-40`.
- An edit during `saving` maps to `dirty` at `apps/web/src/lib/notes/save-state.ts:30-34`, but the older request can still later dispatch `save-ok` and overwrite that state.

**Impact**

If the user types while a save is in flight, the older save response can mark the editor as saved even though a later edit has not been persisted to `Note.body` or reconciled for asset references. Because the interval only saves when `saveState === 'dirty'`, the next save may not happen until another edit occurs.

**Recommendation**

Track an editor revision number:

- Increment a `dirtyRevision` on every `onUpdate`.
- Capture `saveRevision` when the save starts.
- Only accept `save-ok` if `saveRevision === dirtyRevision`.
- If a newer edit occurred, remain `dirty` after the older request succeeds.

Add reducer tests for "edit during saving, old save returns" and a component-level test around the interval behavior.

### P1 - Direct Folder PATCH Can Create Cycles

**Evidence**

- `PATCH /api/folders/[id]` blocks only direct self-parenting at `apps/web/src/app/api/folders/[id]/route.ts:82-84`.
- It verifies access to the new parent at `apps/web/src/app/api/folders/[id]/route.ts:86-89`.
- It then writes `parentId` directly at `apps/web/src/app/api/folders/[id]/route.ts:91-98`.
- The reorder endpoint has the proper descendant guard at `apps/web/src/app/api/folders/reorder/route.ts:71-89`.

**Impact**

An API client can move a folder under one of its descendants through the direct PATCH route. `folderChain()` has a visited-set guard, so this may not infinite-loop, but the tree becomes corrupt and UI/list behavior becomes undefined.

**Recommendation**

Move the descendant-cycle check into a shared server helper and use it from both `PATCH /api/folders/[id]` and `PATCH /api/folders/reorder`. Add an API test that direct PATCH rejects descendant-parent moves with 409.

### P2 - Access-Scope Expansion Will Become a Hot Path

**Evidence**

- `folderChain()` performs one query per ancestor at `apps/web/src/lib/notes/access.ts:34-48`.
- `resolveNoteAccess()` and `resolveFolderAccess()` call `folderChain()` and then query shares at `apps/web/src/lib/notes/access.ts:61-105`.
- `listAccessibleScope()` loads all folders for every list/search scope calculation at `apps/web/src/lib/notes/access.ts:131-155`.
- `GET /api/search` calls `listAccessibleScope()` and passes folder/note ID arrays into raw SQL filters at `apps/web/src/app/api/search/route.ts:49-77` and `apps/web/src/app/api/search/route.ts:113-127`.

**Impact**

This is acceptable for the current scale and explicitly accepted by ADR 0026, but it is the first place list and search latency will grow. It also increases memory and SQL parameter payload size as the folder tree grows.

**Recommendation**

Keep the current implementation for small deployments, but define the upgrade path:

- Use a recursive SQL CTE for descendant expansion when folder count crosses a threshold.
- Consider a closure table/materialized path if folder sharing becomes heavily used.
- Cache per-user accessible scopes for short windows and invalidate on folder/share mutations.
- Batch ancestor/access checks inside request-local helpers instead of repeating sequential `findUnique()` calls.

### P2 - Notes Shell Performs Duplicate List Fetches

**Evidence**

- Server-provided `initialNotes` seeds the client list when no filter is active at `apps/web/src/components/notes/NotesShell.tsx:117-121`.
- `refreshNotes()` immediately fetches `/api/notes` again at `apps/web/src/components/notes/NotesShell.tsx:137-162`.
- `refreshSharedNotes()` makes a second unfiltered `/api/notes` call and filters client-side at `apps/web/src/components/notes/NotesShell.tsx:164-183`.

**Impact**

The first notes screen can do the server query plus two client-side list fetches. This costs extra DB work and makes perceived load more network-sensitive, especially because each list call also computes accessible scope.

**Recommendation**

Return `sharedNotes` as separate server-side initial data, or add a `sharedOnly=1`/`section=shared` API mode. On first hydration, skip the unfiltered `refreshNotes()` when `initialNotes` is already valid for the current URL.

### P2 - `Note.body` Contract Is Inconsistent

**Evidence**

- The Prisma schema describes `Note.body` as canonical markdown in `packages/db/prisma/schema.prisma:81-83`.
- ADR 0022 also states markdown body stays canonical, while the worker persists Yjs separately.
- The editor body-save path writes `editor.getText()` at `apps/web/src/components/notes/Editor/NoteEditor.tsx:252-254`, not markdown.
- Markdown export exists separately via `htmlToMarkdown(editor.getHTML())` in `apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx:22-28`.
- Worker history rows store an empty body marker for snapshots at `apps/worker/src/yjs/persistence.ts:68-77`.

**Impact**

Search/snippets can work with plain text, but API consumers, history, import/export, and documentation disagree about whether `body` is markdown, plain text, or a fallback mirror. This creates maintenance risk and can lead to lost formatting in future features.

**Recommendation**

Pick one explicit contract:

- If `body` is a plain-text search/snippet mirror, rename docs/types/comments to say so and consider renaming the column in a future migration.
- If `body` is intended to be canonical markdown, save generated markdown from the editor instead of `getText()`.
- For history, store either the markdown/plain-text mirror consistently or make `NoteHistory` explicitly Yjs-only for rich snapshots.

### P2 - Expired Shares Are Hidden From Management APIs

**Evidence**

- ADR 0026 says expired rows remain visible in the share dialog.
- Note shares GET filters to active shares only at `apps/web/src/app/api/notes/[id]/shares/route.ts:42-49`.
- Folder shares GET filters to active shares only at `apps/web/src/app/api/folders/[id]/shares/route.ts:42-49`.

**Impact**

Users cannot see or renew expired grants from the share dialog, and the UI cannot distinguish "never shared" from "shared previously but expired". That is a product/ADR drift rather than a security bug.

**Recommendation**

Return expired shares with an `expired: true` or `status: 'expired'` field, and let the UI group active and expired grants. Keep access checks filtering expired grants as they do today.

### P2 - Build Reproducibility Depends on External Font Fetching

**Evidence**

- `apps/web/src/app/layout.tsx:1-21` imports `Inter` and `Newsreader` from `next/font/google`.
- `bun --filter @app/web build` passes when network egress is allowed.
- Without network egress, the build fails while fetching Google Fonts.

**Impact**

CI and Docker image builds require external network access to Google's font endpoint. That is fragile for self-hosted, air-gapped, or proxy-restricted customer environments.

**Recommendation**

Vendor fonts and switch to `next/font/local`, or document the egress requirement explicitly for image builders. For customer-self-hosted software, local fonts are usually the more reliable choice.

### P2 - Worker Redis Connection Ownership Is Ambiguous

**Evidence**

- The worker comments say each worker carries its own connection at `apps/worker/src/index.ts:18-21`.
- Every Worker receives `connection: getRedis()` at `apps/worker/src/index.ts:22-75`.
- `getRedis()` returns a shared singleton at `packages/jobs/src/connection.ts:16-22`.
- A separately-managed connection helper exists at `packages/jobs/src/connection.ts:24-25`.

**Impact**

The implementation and comments disagree. If the intended reliability model is one Redis connection per worker, the current code does not do that. If BullMQ's internal duplication is considered sufficient, the comment should not say otherwise. This matters during Redis interruptions and worker shutdown.

**Recommendation**

Either use `createRedis()` per Worker and close all owned connections during shutdown, or update the comments to document why the singleton is safe with BullMQ here.

### P2 - Invalid Tag IDs Can Surface as Prisma Errors

**Evidence**

- `createNoteSchema` and `patchNoteSchema` validate tag ID shape only at `apps/web/src/lib/api/schemas.ts:25-40`.
- Note create writes nested tag rows directly at `apps/web/src/app/api/notes/route.ts:142-151`.
- Note patch deletes and recreates tag joins directly at `apps/web/src/app/api/notes/[id]/route.ts:97-118`.

**Impact**

A syntactically valid but nonexistent tag ID can turn into a database FK error instead of a clean 400 response. It also leaves a gap around duplicate tag IDs in the request payload.

**Recommendation**

Pre-validate that all tag IDs exist and de-duplicate them before writing. Return `400 unknown tag` for missing IDs. Add tests for unknown and duplicate tag IDs on create and patch.

### P3 - Raw SQL Search Uses `$queryRawUnsafe`

**Evidence**

- Search uses `$queryRawUnsafe` for all three search queries at `apps/web/src/app/api/search/route.ts:57-99` and `apps/web/src/app/api/search/route.ts:111-127`.

**Impact**

The current strings are static and values are parameterized, so this is not an immediate injection finding. The concern is maintainability: future dynamic SQL edits can accidentally move unsafe values into the SQL string.

**Recommendation**

Prefer Prisma's SQL tagged template helpers where possible, or wrap these raw SQL blocks in a small helper that makes the static-SQL invariant explicit and tested.

### P3 - Asset IO Is Fully Buffered and Database-Backed

**Evidence**

- The schema stores asset bytes directly in Postgres at `packages/db/prisma/schema.prisma:157-174`.
- Uploads read the entire request body into a `Buffer` before size validation at `apps/web/src/app/api/notes/[id]/assets/route.ts:40-47`.
- Asset downloads select the full `data` column and create a `Buffer` response at `apps/web/src/app/api/assets/[id]/route.ts:19-35`.

**Impact**

This is acceptable for the current configured file sizes and was an explicit architecture choice, but it concentrates binary IO, memory pressure, backup size, and DB bloat in Postgres. The code has no streaming path or early `Content-Length` rejection.

**Recommendation**

Keep the current approach for small self-hosted installs, but add operational limits and metrics:

- Reject obviously over-limit uploads from `Content-Length` before buffering when the header is present.
- Track asset count, total byte size, largest asset, and preview size in an admin/ops metric.
- Document the migration path to filesystem/object storage if customer data volume grows.

### P3 - Tooling Warnings Should Be Cleaned Up

**Evidence**

- `bun run lint` passes but reports Biome warnings for `<img>` usage in editor components and informational literal-key findings in `apps/web/src/lib/notes/doc-outline.ts:71-142`.
- `bun run lint:next` passes with an unused exhaustive variable warning in `apps/web/src/lib/notes/save-state.ts`.
- Next build warns that `experimental.typedRoutes` moved to top-level `typedRoutes` at `apps/web/next.config.ts:10-12`.
- Next build also warns that the `middleware` file convention is deprecated in favor of `proxy`; the current middleware lives at `apps/web/src/middleware.ts`.

**Impact**

Warnings that always appear become noise. They make real regressions easier to miss and give contributors less confidence in CI output.

**Recommendation**

Clean up the literal-key findings, convert justified `<img>` cases to Biome suppressions instead of ESLint-only comments, remove or rename the unused exhaustive variable pattern, move `typedRoutes` to the new config location, and plan the Next middleware-to-proxy migration.

### P3 - Test Ergonomics Need a Clear Local Preflight

**Evidence**

- CI provisions Postgres and Redis for Vitest at `.github/workflows/ci.yml:101-156`.
- The local test command is simply `vitest run` at `package.json:25`.
- Without accessible local Postgres/Redis, many tests fail during cleanup/setup rather than with a single actionable preflight message.

**Impact**

The test suite is strong, but a new contributor can get a noisy failure wall if they run tests before `make up-dev` or without localhost service access.

**Recommendation**

Add one or more of:

- `make test-integration` that depends on `make up-dev`.
- A preflight script that checks Postgres and Redis before starting Vitest and prints the exact command to fix the environment.
- Split fast pure-unit tests from integration tests that require services.

## Efficiency Improvement Roadmap

1. **Fix build reliability first.** Align worker build scripts with Docker/CI and remove build-time Google font network dependency if customer environments may be restricted.
2. **Harden editor persistence.** Introduce a body-specific version token and a revision-aware save reducer. These are correctness fixes, not polish.
3. **Prevent tree corruption.** Share cycle validation between direct folder PATCH and reorder.
4. **Reduce duplicate fetches.** Seed shared notes from the server or add a dedicated API mode, then avoid immediate unfiltered list refetches on hydration.
5. **Prepare access scope for growth.** Keep current code for small installs, but document a threshold and implementation plan for recursive CTE/closure-table scope expansion.
6. **Clarify content storage.** Decide whether `Note.body` is plain text or markdown, then align schema comments, ADRs, API types, history, and save path.
7. **Lower warning noise.** Keep lint/build output clean so CI remains high-signal.

## Overall Assessment

The repository is well above average in tests and documentation. The notes app is already structured around clear boundaries: API contracts, authorization engine, worker processors, and documented ADR decisions. The highest-value improvements are concentrated in release/build reliability and the editor persistence model. Addressing those will reduce the most serious production risks without requiring a broad rewrite.
