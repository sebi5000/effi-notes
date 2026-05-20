# ADR 0030 — Access-scope expansion: upgrade path and the recursive-CTE step

**Status:** Accepted
**Date:** 2026-05-20
**Supersedes:** none (extends ADR 0026)

## Context

ADR 0026 introduced explicit per-resource sharing and centralised the rules in
`apps/web/src/lib/notes/access.ts`. The QA review of 2026-05-20 flagged that
those rules will become a hot path as folder count grows:

- `folderChain()` issues **one Prisma query per ancestor** — for a note 8
  folders deep, every `resolveNoteAccess()` runs 8 sequential `findUnique()`
  calls. This is the highest-frequency authorisation primitive in the app.
- `listAccessibleScope()` calls `prisma.folder.findMany({ select: { id,
  parentId, ownerId } })` with no `where` clause: it loads every folder
  the database has, then BFS-expands the user's roots in memory. The 1× query
  is faster than per-ancestor lookups, but the payload size scales with the
  whole tenant tree, not the user's share footprint.
- `GET /api/search` and `GET /api/notes` each call `listAccessibleScope()`
  once per request and pass the result into raw-SQL filters. The same scope
  is recomputed even when consecutive requests come from the same session.

ADR 0026 accepted this for the initial scale ("small deployments, dozens of
folders, single-tenant"). The review's recommendation is to keep the current
implementation for now but commit to an explicit upgrade plan with measurable
triggers, so the team doesn't end up improvising under load.

## Decision

Adopt a four-step upgrade path. Each step is independently shippable and
gated by an observable trigger; the steps are NOT planned to land together.

### Step 1 — Single-query `folderChain()` via recursive CTE (ship now)

Replace the N-query loop in `folderChain()` with one `$queryRaw` that walks
the parent chain using a `WITH RECURSIVE` CTE. The depth cap
(`MAX_FOLDER_DEPTH = 64`) becomes the CTE's recursion guard. Behaviour is
identical — same return shape, same cycle safety (Postgres `WITH RECURSIVE`
on a self-join can't revisit a row in the same chain because we anchor on
the leaf id) — but the network round-trip count drops to 1 regardless of
tree depth. Every higher-level helper (`resolveNoteAccess`,
`resolveFolderAccess`) inherits the win without changing.

This is the only step that lands in this ADR's commit. Trigger to ship:
"the chain pattern is the easiest high-impact win to take today, and it
makes every other helper cheaper to measure later."

### Step 2 — `listAccessibleScope()` via a single user-scoped CTE

When folder count crosses an observed threshold (target: p95 of
`listAccessibleScope` Postgres time > 50 ms, or `findMany` payload > 1 MB),
replace the load-everything-then-BFS pattern with one parameterised
recursive CTE that takes the user's owned + folder-share roots as a seed and
returns only their reachable descendants. Combined with the existing
share-share queries it stays a 3-query operation but each query is scoped
to the user, not the whole tenant.

Trigger to ship: an OTel histogram on `notes.list` /
`notes.search` shows the `listAccessibleScope` span dominating latency, or a
manual `EXPLAIN ANALYZE` against a production-shaped folder tree exceeds
the SLO above.

### Step 3 — Closure table or materialised path

If folder sharing becomes heavily nested (more than ~5000 reachable folders
per user, or recursive CTEs themselves dominate the plan), introduce a
denormalised structure that materialises every ancestor-descendant pair.
Maintained via a Postgres trigger on `Folder` (insert / update of `parentId`
/ delete). Read paths become a single non-recursive join. Write paths cost
one extra trigger fire; the maintenance is local to the migration that
creates the table and not visible to the app code.

Trigger to ship: Step 2's recursive CTE is itself the bottleneck under
load, or analytics queries on folder hierarchy need closure semantics for
reasons unrelated to authorisation.

### Step 4 — Per-request memoisation

Once the resolve calls are cheap enough that the round-trip is the
remaining cost, wrap `listAccessibleScope`, `resolveNoteAccess`, and
`resolveFolderAccess` in a per-request memo keyed on
`(userId, folderId?, noteId?)`. Lifetime is one HTTP request — no
cross-request cache, no invalidation logic, no shared state. The win is for
endpoints that resolve multiple resources in one request (bulk patch,
search hit hydration).

Trigger to ship: a request shows duplicate scope expansions in OTel
traces, or a bulk endpoint pages access checks N times.

## Explicitly NOT decided

- **Per-process / cross-request cache (Redis or in-memory):** rejected
  for now. Invalidation on every Share / Folder mutation across HA replicas
  is more failure modes than the current latency justifies.
- **Move authorisation into the database (RLS):** rejected — auth.js
  session subjects map to our `User` table via `keycloakSub`, not a
  Postgres role, and our Prisma queries use a single connection pool
  user. Adding RLS would require an entirely different connection model.
- **Hand-rolled SQL across all of `access.ts`:** Step 1 only touches
  `folderChain()`. The other helpers stay on Prisma's query builder so
  callers and tests don't need to change.

## Consequences

**Positive.**
- One round-trip for `folderChain()` instead of N; immediate visible
  speedup on every list / search / route guard for deep folder trees.
- Upgrade path is recorded with explicit triggers, so future load work has
  a checklist instead of a redesign.

**Negative / risks.**
- Step 1 introduces raw SQL into the access engine. Mitigated by:
  using `Prisma.sql` tagged templates (no string concatenation possible),
  keeping the function signature identical, and running the existing
  `access.test.ts` suite as a regression net.
- Future steps will need their own ADRs (or amendments to this one) when
  the triggers are met — this ADR records the plan, not a commitment to
  ship Steps 2-4 in any particular timeframe.

## Verification (Step 1)

`bun run typecheck`, `bun run vitest run apps/web/src/lib/notes/access.test.ts`,
the broader integration tests under `apps/web/src/app/api/`. A focused test
asserts the CTE returns the same chain as the previous loop on a known
fixture (deep tree, cycle, missing root).
