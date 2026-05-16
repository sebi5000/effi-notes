# CLAUDE.md — Project conventions for the AI assistant

This file is a contract, not documentation. Keep it in sync with reality.

## Project identity

B2B web app **template** intended to be forked per customer. Single-tenant deployments via Docker Compose, vendor-supported remotely. Goal: a small, sharp skeleton — auth, jobs, observability, audit-log table — and nothing more. Customer projects add domain entities; the template stays generic.

## Data scope (template-only)

Two tables: `User` (Keycloak-subject mirror) and `AuditLog` (append-only audit trail with non-auto-wired helper). **Nothing else** in `prisma/schema.prisma`. Domain entities, feature-flag tables, idempotency keys, integration metadata — all of these belong in customer projects.

Feature flags are env-based via `@app/config` (`flags.<name>`). If a customer project needs runtime toggling, they introduce a table or external service themselves.

## Stack (do not change without an ADR)

- Bun 1.3.x as runtime **and** package manager (no Node fallback in production)
- Next.js 16 App Router, React 19, TypeScript 6 strict
- TailwindCSS 4 + shadcn/ui
- Prisma 7 (rust-free `prisma-client` generator, `runtime = "bun"`)
- PostgreSQL 16, Redis 7
- Keycloak 26.x LTS + auth.js v5 (`@auth/core`)
- BullMQ 5 + ioredis
- OpenTelemetry SDK → OTLP → Loki / Tempo / Prometheus / Grafana
- Caddy as reverse proxy
- Biome (format + lint) + ESLint (Next-specific rules only)
- Lefthook for git hooks
- Vitest + Playwright for tests
- Conventional Commits + Changesets

## Hard rules

1. **TypeScript strict, no `any`** without a `// reason: …` comment on the same line
2. **Zod validates every external boundary**: env, route-handler bodies, job payloads, third-party API responses
3. **Never run `prisma db push` against a production database**. Always use `prisma migrate deploy`
4. **All env vars are validated in `packages/config`**. Adding an env var without updating the schema **and** `.env.example` is a bug
5. **Every service in Compose has a healthcheck, restart policy, resource limits, non-root user**
6. **Workspace imports use `@app/<package>`**. No `../../packages/...` paths
7. **Pre-commit (lefthook) is mandatory**. If a hook fails, fix the cause; do not bypass with `--no-verify`
8. **Conventional commits**. Breaking changes are tagged with `!:` and an ADR
9. **No invented versions** — verify against `npm view <pkg> version` before pinning
10. **Decisions with tradeoffs get an ADR** in `docs/adr/`. No silent choices
11. **Never `console.log` in app code** — use `createLogger` from `@app/observability/logger`. Exceptions: `instrumentation.ts` files (logger not yet ready) and the env-validation failure path

## Workspace conventions

- Package names: `@app/web`, `@app/worker`, `@app/db`, `@app/config`, `@app/observability`, `@app/auth`, `@app/jobs`, `@app/ui`
- Workspace dep syntax: `"@app/config": "workspace:*"`
- Each package: `tsconfig.json` extends `../../tsconfig.base.json`, has `typecheck` script
- Apps build with their own toolchain (Next for web, Bun for worker). Packages are TS-only — consumed in source via Bun's bundler

## Bun-specific gotchas to remember

- OpenTelemetry: **programmatic init** in `instrumentation.ts` (Next) and at worker entry. **Not** via `--require`
- Prisma: rust-free generator with `runtime = "bun"` and `@prisma/adapter-pg`. **No** `binaryTargets` config needed
- Some `@opentelemetry/auto-instrumentations-node` modules may not load under Bun. Curate an explicit allow-list (HTTP, PG, Redis, Pino, Next-Fetch)
- `Bun.serve()` is NOT auto-instrumented — but we use Next's HTTP layer, so this does not affect us
- Long-running worker (>72h): add memory-watchdog + healthcheck threshold

## Testing

- **Unit/integration**: Vitest (`vitest`, `@vitest/ui`, `vitest-environment-jsdom`)
- **E2E**: Playwright, focused on auth flows and golden paths
- Integration tests **MUST hit a real Postgres**, never mocks. Use a separate test DB
- Run via `bun run vitest`, never `bun test` (DOM/jsdom integration is not equivalent yet)

## Auth (read this before touching anything auth-related)

> **For Claude in a customer project that forked this template:** the auth plumbing below is intentional and stable. Customer projects add features **on top** of it (new protected routes, new roles, new claim mappings) but should not rewrite the wiring without an ADR. If you find yourself wanting to change the JWT callback, the refresh logic, or the user-upsert semantics — stop and write an ADR first.

Notes and folders are **private by default**. Access is governed by explicit `Share` grants — see ADR 0026 and `apps/web/src/lib/notes/access.ts`. That module is the single authorisation source for the notes domain; every guarded route handler calls into it and no handler duplicates access logic inline.

### Architecture (where things live)

```
apps/web/src/
├── auth.ts                                       # Single NextAuth() instance — { auth, signIn, signOut, handlers }
├── middleware.ts                                 # Public/private path gate; redirects to /login
├── app/
│   ├── api/auth/[...nextauth]/route.ts           # auth.js HTTP endpoints (do not add to)
│   ├── api/health/{live,ready}/route.ts          # Probes for orchestrator
│   ├── login/page.tsx                            # Single sign-in button → Keycloak
│   └── dashboard/page.tsx                        # Protected example page; pattern for other pages

packages/auth/src/
├── index.ts                                      # Public exports + side-effect type augmentation
├── types.ts                                      # Role union, AppUser shape, Session/JWT augmentation
├── config.ts                                     # NextAuthConfig: provider, callbacks, refresh, upsert
└── rbac.ts                                       # hasRole, requireRole, ForbiddenError
```

### Identity flow

1. User clicks "Sign in" on `/login` → server action calls `signIn('keycloak')`
2. auth.js redirects browser to Keycloak's authorisation endpoint with PKCE
3. User authenticates against Keycloak (Keycloak handles federation, MFA, password policies — not us)
4. Keycloak redirects to `/api/auth/callback/keycloak` with the auth code
5. auth.js exchanges code for tokens; the `jwt` callback runs
6. **First login or refresh:** `upsertUser()` (in `packages/auth/src/config.ts`) writes a row in our `User` table keyed by Keycloak `sub`. Roles in our `User.roles` are filtered to known `Role` values
7. The session JWT now carries `appUser` (typed as `AppUser`), `accessToken`, `refreshToken`, `accessTokenExpiresAt`
8. On subsequent requests, the `jwt` callback re-runs; if the access token is within 30s of expiry, we call Keycloak's `/protocol/openid-connect/token` to refresh. On refresh failure we set `session.error = 'RefreshAccessTokenError'` — the dashboard checks for this and redirects to `/login`

### Source of truth

- **Identity (who you are):** Keycloak. Email changes, password resets, MFA, federation — all in Keycloak's admin UI / by admin API. Never write user-management code in this app.
- **Application user (foreign-key target, audit actor):** `User` table in our DB. Mirror only — `keycloakSub` is the join key. Adding columns is fine; never make this table the auth source.
- **Roles:** Realm roles in Keycloak. Mapped into the access token via the `realm roles` protocol-mapper (configured in `deploy/keycloak/realm-export.json`). `Role` union in `@app/auth/types` lists what the app understands.

### Session shape (what `session.user` gives you)

```ts
type AppUser = {
  id: string;            // our DB user.id (cuid) — use for FKs and audit
  keycloakSub: string;   // Keycloak sub claim — stable across email changes
  email: string;
  displayName: string | null;
  locale: string;
  roles: ReadonlyArray<Role>;
};
```

### How to use the session (patterns)

**Server component:**

```tsx
import { auth } from '@/auth';

export default async function MyPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return <p>Hello {session.user.displayName}</p>;
}
```

**Route handler:**

```ts
import { auth } from '@/auth';
import { requireRole } from '@app/auth/rbac';

export const POST = auth(async (req) => {
  if (!req.auth) return Response.json({ error: 'unauthorised' }, { status: 401 });
  requireRole(req.auth.user, 'admin');     // throws ForbiddenError → 500 unless caught
  // … do thing …
});
```

**Server action:**

```ts
'use server';
import { auth } from '@/auth';
import { requireRole } from '@app/auth/rbac';

export async function updateThing() {
  const session = await auth();
  requireRole(session?.user, ['admin', 'ops']);
  // …
}
```

**Client component (rare — prefer server reads):**
Pass session down as a prop from a server component. Do **not** call `useSession()` in client code unless you genuinely need real-time session updates; it costs a network round-trip on each render.

### How to add things (the supported extension points)

| You want to… | Where to change | Don't touch |
|---|---|---|
| Add a new role | `Role` union in `packages/auth/src/types.ts` **AND** add the role in `deploy/keycloak/realm-export.json` (or via Keycloak admin UI for live realms) | The JWT callback or refresh logic |
| Protect a new page | Wrap the page in `auth()` (RSC) or `requireRole()`. Middleware already redirects unauthenticated requests | The middleware matcher unless absolutely necessary |
| Add a public path | Add to `PUBLIC_PATHS` in `apps/web/src/middleware.ts` | The matcher regex (it intentionally lets static assets through) |
| Add a session field | Extend `AppUser` in `packages/auth/src/types.ts`, populate in `upsertUser()` and the `jwt` callback in `config.ts` | The realm-export client mapper layout — re-export the realm cleanly |
| Surface a Keycloak attribute | Add a protocol-mapper in the realm export, then read `profile` in the `jwt` callback | The catch-all `[...nextauth]/route.ts` |
| Forbid an action with HTTP 403 | `requireRole()` + a Next error boundary that converts `ForbiddenError` to 403 | `redirect('/login')` from inside a route handler — return a JSON 401 instead |

### Hard rules (auth-specific)

1. **Never bypass auth.js with a hand-rolled session cookie.** The JWT cookie is signed with `AUTH_SECRET`; verifying it requires auth.js
2. **Never write to `User.keycloakSub`** outside `upsertUser()`. The mapping is the integrity contract
3. **Never read `process.env.KEYCLOAK_*` directly.** Use `env` from `@app/config/env` so the Zod schema gates everything
4. **Never store the Keycloak access token in the database.** It lives in the JWT cookie only. Reasons: tokens are short-lived; they would silently rot in stale rows; they are credentials and DB encryption-at-rest is not the same as a tightly scoped cookie
5. **Never wire audit logging into the auth callback for "user.login" by default.** It is tempting; resist. Customers may not want every login captured for retention/GDPR reasons. Provide it as a sample in customer-install docs instead
6. **Don't use auth.js database sessions.** We use JWT sessions because Keycloak owns identity. Switching to DB sessions doubles the failure modes for no benefit
7. **`AUTH_TRUST_HOST` is `false` in dev**. Set it to `true` only when behind Caddy (Phase 6) so `X-Forwarded-Host` is honoured. Never set it to `true` for an app exposed directly to the internet without a known proxy

### Common pitfalls (Bun + auth.js v5)

- **`signIn()` only works in a server action / route handler.** Calling it from a client onClick will fail at build time
- **The `jwt` callback runs on every request needing the session.** Keep it cheap: `upsertUser()` runs only when `account` is non-null (i.e. on the auth-code exchange) and on refresh — not on every page render
- **Token refresh runs at every request once the token is near expiry**, but multiple concurrent requests can race. auth.js v5 mitigates this; if you see duplicate refresh calls in production, the next step is a per-process refresh-lock — write an ADR before adding it
- **Bun does not auto-instrument fetch with OTel** — refresh calls to Keycloak will be visible in Tempo only via the manual Undici instrumentation we add in Phase 5

### What customer-side admins do (not us, not Claude in customer projects)

These belong in `docs/customer-install.md`:

- Rotate `app-web` client secret on first install and update `KEYCLOAK_CLIENT_SECRET`
- Delete or disable the default `test@example.invalid` user
- Adjust `redirectUris` and `webOrigins` to the production hostname
- Wire identity federation to their existing IdP (LDAP, Azure AD, Okta) via Keycloak's *Identity Providers* / *User Federation*
- Configure realm SMTP for password-reset email
- Switch Keycloak `start-dev` → `start` and set `KC_HOSTNAME` for production

The app code does **not** care about any of this — it just trusts whatever is at `KEYCLOAK_ISSUER` to be a working OIDC provider with the `app-web` client.

## Jobs (read this before adding a queue)

> **For Claude in a customer project:** the BullMQ + Bull Board plumbing is intentional. Customer projects add **new queues** by following the pattern below. Don't add a different job library, don't change the connection options, don't move queue definitions out of `@app/jobs`.

### Architecture (where things live)

```
packages/jobs/src/
├── connection.ts        # Single ioredis client factory (BullMQ-tuned options)
├── queues.ts            # Queue names, Zod payload schemas, typed producer helpers
└── index.ts             # Public exports

apps/worker/src/
├── index.ts             # Worker entry: BullMQ Workers + Bun.serve HTTP for Bull Board
├── bull-board.ts        # Mounts Bull Board at /admin/queues using @bull-board/bun
└── processors/<name>.ts # One file per queue's processor function

apps/web/src/app/
├── admin/queues/[[...slug]]/route.ts  # Auth-gated reverse proxy → worker:3100
└── dashboard/actions.ts                # Server actions that enqueue from the UI
```

### Identity flow for a job

```
[user clicks button] → server action → enqueueDemoJob(payload) → Redis
                                                                   ↓
            BullMQ Worker (apps/worker) ← processor(job) ← Job picked up
                                                                   ↓
                                                          job.log(...) → Bull Board
```

### Source of truth

- **Queue names:** `QUEUES` const in `packages/jobs/src/queues.ts`. Web and worker import from the same module — never hard-code strings
- **Payload shape:** Zod schema next to the queue. Producers `.parse()` before pushing; processors trust the typed payload
- **Connection options:** `getRedis()` / `createRedis()` from `@app/jobs/connection`. Both use `maxRetriesPerRequest: null` and `enableReadyCheck: false`. Required by BullMQ — see ADR 0018

### How to add a queue (the supported pattern)

Walk through this every time. Skipping a step bites later.

1. **Define the queue in `packages/jobs/src/queues.ts`:**
   - Add the name to the `QUEUES` const
   - Define a Zod schema `MyJobSchema` and `type MyJobPayload`
   - Lazy-instantiate the Queue with sensible `defaultJobOptions` (retries, backoff, retention)
   - Export `enqueueMyJob(payload, opts?)` that validates with Zod, then `add()`s
   - Export `getMyQueueCounts()` if dashboards need depth visibility
   - Add the queue to `getQueueForBullBoard()`'s switch
2. **Implement the processor in `apps/worker/src/processors/<name>.ts`:**
   - Pure function `(job: Job<MyJobPayload>) => Promise<Result>`
   - Idempotent if at all possible — BullMQ retries on throw
   - `job.log(...)` for observability; never `console.log` for job-level events (no trace correlation)
3. **Register the Worker in `apps/worker/src/index.ts`:**
   - `new Worker(QUEUES.myJob, processMyJob, { connection: getRedis(), concurrency: env.WORKER_CONCURRENCY })`
   - Wire `failed` and `error` event handlers (logging)
4. **Producer side (web):**
   - Server action calls `enqueueMyJob(...)` and optionally `recordAudit({ action: 'jobs.myJob.enqueued', actorId, subject: jobId })`
5. **No middleware changes** — Bull Board already shows new queues automatically

### Hard rules (jobs-specific)

1. **Never share a Redis connection between Worker and Queue.** BullMQ buffers blocking commands on the Worker connection; reusing it for `Queue.add()` deadlocks. `getRedis()` returns a singleton intended for the Queue / producer side; Workers create their own (BullMQ does it internally when given a connection at construction)
2. **Never push to a queue without Zod validation.** The producer helpers in `@app/jobs` enforce this. Bypassing them with `new Queue('foo').add(...)` defeats the typing contract
3. **Never run `prisma migrate` from inside a Worker process.** The web app's container entrypoint owns migrations
4. **Never expose the worker's port (3100) publicly.** Bull Board has *no built-in auth* — the only ingress is `/admin/queues/*` in `apps/web`, which checks the `ops` role
5. **Never use `removeOnComplete: true` for production-grade jobs without retention policy.** BullMQ deletes the job AND its logs immediately, defeating debugging. Use `{ age: <seconds>, count: <max> }` instead — see `defaultJobOpts` in `queues.ts`
6. **Never store domain payloads larger than ~100 KB in a job.** Redis is RAM. Pass an entity id; let the processor fetch from Postgres
7. **Cron / repeatable jobs go in the worker entry, not in business logic.** Use BullMQ's `JobScheduler` / `repeatable` pattern; don't reinvent with `setInterval`

### Common pitfalls (Bun + BullMQ)

- **The `noeviction` Redis policy is mandatory.** Without it, Redis under memory pressure may evict BullMQ's bookkeeping keys, corrupting queue state silently. Compose pins this in `redis-server --maxmemory-policy noeviction`. ADR 0018
- **OpenTelemetry does not auto-instrument BullMQ jobs.** We wrap `processor` with a manual `tracer.startActiveSpan` in Phase 5 — leave the processor signatures pure for now
- **`bun --watch` reloads kill BullMQ workers without draining.** Acceptable in dev (jobs return to `waiting`), but **never** in prod — the prod entrypoint must be `bun src/index.ts`, not `--watch`
- **Long-running jobs (>30 min) need `lockDuration` tuned** — the Worker's lock expires by default at 30s. Set per-queue, not globally

### Bull Board ingress (architecture detail)

```
browser → GET /admin/queues/* (apps/web)
            ↓ auth.js middleware → requireRole('ops')
            ↓ reverse-proxy fetch → http://worker:3100/admin/queues/*
            ↓ Bun.serve in apps/worker
            ↓ @bull-board/bun BunAdapter
```

The proxy is a streaming pass-through. It does **not** rewrite HTML or asset paths because Bull Board's `setBasePath('/admin/queues')` already produces the correct URLs. If you change the basePath, change it in **both** `bull-board.ts` (worker) and the route's path in `apps/web` — they must match.

### What customer admins do (not us)

- Pin Redis-side memory based on their queue throughput (default 256 MB is fine for a few hundred jobs/min)
- Decide retention policy for completed/failed jobs — defaults are 24 h / 7 days
- Wire alerts on Bull Board's failed-count metric (Phase 5 OTel wiring exposes counts as Prometheus gauges)

## Observability (read this before adding logs / metrics / traces)

> **For Claude in a customer project:** the observability plumbing — OTel SDK init, Pino logger with trace correlation, the otel-collector → Loki/Tempo/Prometheus → Grafana stack — is the universal infrastructure. Customer projects add domain dashboards and span-wrap their own code paths but should not change the SDK init order, the allow-list, or the collector pipelines without an ADR. The `obs` Compose profile is opt-in (`make up-obs`) so the default stack stays small.

### Architecture

```
[apps/web ─ Next.js]            [apps/worker ─ Bun]
   instrumentation.ts (Next       src/instrumentation.ts (FIRST import)
   register hook)                    │
       │                              │
       ▼                              ▼
   @app/observability/otel.ts  ─────  initOtel({serviceName})
                                       │
                                       │ traces / metrics / logs (OTLP HTTP)
                                       ▼
                          ┌──── otel-collector ────┐
                          ▼            ▼            ▼
                       loki         tempo      prometheus
                          │            │            │
                          └──────► grafana ◄───────┘
                                  (Application Overview dashboard)
```

### Hard rules (observability-specific)

1. **The OTel SDK init must run BEFORE any module that needs to be instrumented is imported.** In Next.js this is automatic (`instrumentation.ts` hook). In the worker it is `import './instrumentation.ts'` as the **first** statement — moving any other import above it silently disables tracing for that module
2. **Never `console.log` in app code.** Use the logger from `@app/observability/logger`. `console.warn` / `console.error` are tolerated only inside `instrumentation.ts` files (where the logger is not yet available) and the env-validation failure path
3. **Never call `trace.getTracer(...).startActiveSpan(...)` directly.** Use `withSpan(name, attrs, fn)` from `@app/observability/tracing` — it sets status + records exceptions + ends the span correctly under errors
4. **Never add a new instrumentation library without updating ADR 0016.** The allow-list is the contract; auto-loading every instrumentation under Bun has historically broken builds
5. **OTLP endpoint empty = no telemetry leaves the box.** This is the DSGVO toggle — never override `OTEL_EXPORTER_OTLP_ENDPOINT` to a hard-coded value in code, only via env
6. **Resource attributes (`service.name`, `service.version`, `deployment.environment`) come from the SDK init, not from individual log lines.** Adding them to every log call duplicates fields and confuses Loki indexing
7. **Span names use dot.notation, not slashes or human prose.** Examples: `demo.process`, `auth.token.refresh`, `db.users.upsert`. They become metrics (`<name>_duration_milliseconds_bucket`) — keep them stable

### How to add observability (the supported patterns)

**Add a log statement:**

```ts
import { createLogger } from '@app/observability/logger';
const log = createLogger({ component: 'auth.callback' });
log.info({ userId, tookMs }, 'sign-in completed');
log.error({ err: err.message }, 'sign-in failed');
```

The OTel pino instrumentation injects `trace_id` and `span_id` automatically — no manual work needed.

**Wrap a code path in a span (e.g. a new BullMQ processor):**

```ts
import { withSpan } from '@app/observability/tracing';

export const processInvoice = (job: Job<InvoicePayload>) =>
  withSpan('invoice.process', { 'job.id': job.id, 'invoice.id': job.data.invoiceId }, async () => {
    // … work …
  });
```

`withSpan` sets `OK`/`ERROR` status, records the exception, and ends the span on throw — do not manually `span.end()`.

**Add a metric:**

```ts
import { metrics } from '@opentelemetry/api';
const meter = metrics.getMeter('app-web');
const signIns = meter.createCounter('app.signins.total');
signIns.add(1, { provider: 'keycloak' });
```

Histograms for latency, gauges for queue depth — same pattern. The OTel exporter ships them; Prometheus scrapes the OTLP endpoint; Grafana queries Prometheus.

**Add a Grafana dashboard:**

Drop a JSON file in `deploy/grafana/dashboards/`. Grafana provisioning picks it up on next start. Use `prometheus`, `loki`, or `tempo` as the datasource UID — they are pinned in `deploy/grafana/provisioning/datasources/datasources.yaml`.

### What ships in the template (and what does not)

| Ships | Does NOT ship |
|---|---|
| OTel SDK with curated allow-list (HTTP, undici, pg, ioredis, pino, prisma) | Customer-specific span-wrapping of domain code |
| Pino logger with trace-context injection | Audit-log auto-wiring (Phase 2 stays opt-in) |
| `otel-collector` → Loki / Tempo / Prometheus pipelines | Alert rules — those are tied to customer SLAs |
| One default dashboard: Application Overview | Domain dashboards (sales, customer KPIs, etc.) |
| 30-day Loki / 14-day Tempo retention | Off-site log shipping (customer adds remote_write or sets `OTEL_EXPORTER_OTLP_ENDPOINT` to vendor URL) |

### Common pitfalls (Bun + OTel)

- **`@opentelemetry/auto-instrumentations-node` is a meta package** that pulls in instrumentations for libraries we do not use AND some that break under Bun. Use individual instrumentations only — the explicit allow-list in `packages/observability/src/otel.ts` is the contract
- **Bun's HTTP server (`Bun.serve`) is NOT auto-instrumented.** The worker's HTTP port (Bull Board) shows up in traces only via the `withSpan` calls in processors. Next.js HTTP requests are covered because they go through the Node HTTP path
- **`pino-opentelemetry-transport` runs in a worker thread.** It does not see the parent's OTel context — trace correlation is via `trace_id` in the log record, injected by `@opentelemetry/instrumentation-pino`
- **`memory_limiter` in the collector is in MiB, not MB**, and rejects telemetry on overflow rather than crashing. If you see `memory_limiter` log lines, raise the limit in `deploy/otel-collector/config.yaml` — don't disable it
- **Tempo's metrics generator emits `traces_spanmetrics_*` series** which Prometheus stores and Grafana renders as a service map. Disabling the generator silently breaks the service-map view

### Customer-side adjustments

- Set `OTEL_EXPORTER_OTLP_ENDPOINT` to *their* observability backend if they use a SaaS (Datadog, Honeycomb, Grafana Cloud) — keep the local stack OFF in that case (omit `--profile obs`)
- Bump Loki/Tempo retention based on disk capacity (defaults: 30 / 14 days)
- Add scrape configs to `deploy/prometheus/prometheus.yml` for node-exporter / cAdvisor if they want infra metrics
- Set `GF_SECURITY_ADMIN_PASSWORD` from a secret, not the `admin` default

## Hardening (read this before changing the production stack)

> **For Claude in a customer project:** the production-ready stack — Caddy in front, web + worker as containers, the migrator one-shot pattern, security headers, Redis-backed rate limit, backup scripts — is the universal hardening shape for every customer install. Customer projects extend it (add CSP nonces, scale workers, swap auto-TLS for company certs, add WAF rules) but should not remove the hardening. Each shipping piece has a defined extension point.

### Production topology

```
┌──── customer host ────────────────────────────────────────────────┐
│                                                                   │
│   :80/:443  Caddy (auto-TLS via ACME, security headers)          │
│       │                                                           │
│       ├──► web    Next.js standalone, Node-style server (Bun)     │
│       └──► auth   reverse-proxy → keycloak                        │
│                                                                   │
│   web depends-on: migrator (completed_successfully) → postgres-app│
│                                                                   │
│   worker        BullMQ + Bull Board (port 3100, internal only)    │
│                                                                   │
│   postgres-app, postgres-keycloak, redis (with --maxmemory-policy │
│       noeviction)                                                 │
│                                                                   │
│   [obs profile] otel-collector → loki / tempo / prometheus        │
│                              ↓                                    │
│                          grafana                                  │
└──────────────────────────────────────────────────────────────────┘
```

Networks (Compose):

| Network | Members | Purpose |
|---|---|---|
| `net-edge` | caddy, web | Public ingress only — Caddy is the only listener with host-bound ports |
| `net-app` | caddy, web, worker, keycloak | App-internal traffic. Caddy reverse-proxies keycloak here |
| `net-data` | web, worker, migrator, postgres-app, postgres-keycloak, redis | Data-tier; never exposes to host except via dev override |
| `net-obs` | web, worker, otel-collector, loki, tempo, prometheus, grafana | Telemetry pipeline; profile-gated |

### Image build (multi-stage Bun)

Both `apps/web/Dockerfile` and `apps/worker/Dockerfile` are multi-stage:

1. **deps** — `oven/bun:1.3.13-alpine` + `bun install --frozen-lockfile` over the whole monorepo. Workspace resolution requires the directory layout intact, so we copy the repo (with a strong `.dockerignore`) rather than cherry-picking package.json files
2. **build (web)** / **prisma-generate (worker)** — runs `bun --filter @app/db generate` then either `next build` (web) or noop (worker is plain TS)
3. **runtime** — non-root `app` user, ports 3000 / 3100, `bun apps/web/server.js` or `bun apps/worker/src/index.ts`

The build context is the **repo root** for both Dockerfiles. Build-arg `BUN_VERSION` is overrideable; pin in Compose.

`DATABASE_URL` is set to a placeholder during `next build` because Prisma's config loader resolves `env()` at parse time. The placeholder is never used — Next does not connect.

### Migration pattern (zero-downtime updates)

The `migrator` service uses the worker image with overridden `command: ["bun", "--filter", "@app/db", "migrate:deploy"]`. It runs once, applies pending Prisma migrations, exits 0. Web and worker depend on it via `service_completed_successfully`, so:

- Fresh install: stack up → migrator runs → web/worker start
- Update: pull new image tags → `docker compose up -d` → migrator runs new migrations → web/worker restart with new code

For *additive* migrations this is zero-downtime — old web kept serving while new schema is applied (Postgres migrations are non-blocking for additive changes). For *destructive* migrations the customer schedules a maintenance window. ADR 0019 documents the pattern.

### Caddy configuration (auto-TLS + security headers)

Two sites in `deploy/caddy/Caddyfile`:

- `${APP_HOSTNAME}` — reverse-proxy to `web:3000`
- `${AUTH_HOSTNAME}` — reverse-proxy to `keycloak:8080`

Hostnames come from the customer's `.env` (`APP_HOSTNAME`, `AUTH_HOSTNAME`, `ACME_EMAIL`). Default is automatic ACME via Let's Encrypt — customer host needs outbound 443 to ACME servers. Air-gapped customers comment out the auto-TLS and set `tls /path/cert.pem /path/key.pem` (documented inline in the Caddyfile).

Security headers are imported from `deploy/caddy/snippets/security-headers.caddy` so every site has them with no drift:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy:` minimal default (deny all features)
- CSP baseline (with `'unsafe-inline'` for script/style — Next.js RSC payload requires this; customer projects can upgrade to nonces)
- `-Server` header removed

Customer projects that need stricter CSP (nonce-based, no inline) wire a Next.js middleware that injects the nonce into both the `<script>` tags and the response header. ADR 0020.

### Rate limiting (`/api/auth/*`)

`apps/web/src/lib/rate-limit.ts` is a Redis-backed sliding-window limiter (single sorted set per `scope:key`, one round-trip per check). The auth catch-all route wraps `handlers.GET` / `handlers.POST` with a 30-req/min/IP guard.

Why in-app and not in Caddy:
- The vanilla `caddy:alpine` image does not include `caddy-ratelimit`. Building a custom image with `xcaddy` is fine but pushes more ops surface to customers
- Using Redis means the limit is shared across web replicas if a customer scales horizontally
- Per-route, per-user, per-feature limits are easy to add: `await rateLimit({ key: userId, scope: 'invoice.export', max: 5, windowMs: 60_000 })`

ADR 0021 captures this choice.

### Backup and restore

`deploy/scripts/backup.sh` writes:

- `postgres-app.sql.gz` — `pg_dump` of the application database
- `postgres-keycloak.sql.gz` — same for the Keycloak realm/users database
- `redis-dump.rdb.gz` — BullMQ in-flight state (BGSAVE-based)
- `manifest.json` — timestamp + content listing

Off-site replication is **not** in the template per ADR 0013. Customers add a cron + their tool (rclone, restic, borg) that ships `./backups/` to whichever remote storage they trust. The scripts are designed so the directory is fully self-contained.

`restore.sh` is destructive — it drops and recreates both databases. It pauses web + worker first (databases stay up to receive the restore), prompts for `yes` confirmation, and prompts again before touching Redis (Redis-restore is rarely useful since BullMQ replays from producers).

### Hard rules (hardening-specific)

1. **Caddy listens on `:80` and `:443` of the host. Nothing else does.** If you need to expose another port to the public, route it through Caddy. Direct host-port mappings outside dev-override are a security regression
2. **Workers and the worker's port 3100 stay on `net-app` only.** The `/admin/queues` ingress goes through `apps/web` so auth.js + ops-role gating applies. Exposing 3100 publicly defeats the entire Phase-3 auth design
3. **`prisma migrate deploy` runs only via the migrator service** — not from web on startup, not by hand on production. Two reasons: idempotent in concurrent web replica startups, and observable as a discrete step (separate logs, separate exit code)
4. **`AUTH_SECRET` and `KEYCLOAK_CLIENT_SECRET` are set via the customer's `.env` file**, never baked into images, never committed. Compose validates with `${VAR:?...}` syntax — missing values fail `docker compose up` loudly
5. **Containers run as non-root.** Both Dockerfiles add an `app` user. If a customer modification needs root at runtime, write an ADR explaining why
6. **Image tags are SemVer + git SHA, never `latest`** in production. The Compose `image:` lines pin `app-template-{web,worker,migrator}:latest` for *local* dev; CI overrides with the real tag at deploy time
7. **Backup before any destructive maintenance.** `restore.sh` exists for the day someone runs the wrong migration — keep it well-documented and obvious

### Common pitfalls (Bun + Next standalone + Caddy)

- **Next standalone preserves the monorepo path** — `apps/web/server.js`, not just `server.js`. Don't try to `WORKDIR /app/apps/web` to shorten the entrypoint; the standalone build references `node_modules` from the standalone root
- **`next build` fails without DATABASE_URL** even though it never connects — Prisma's config-loader evaluates `env()` early. Set a placeholder URL in the build stage (we do this in `apps/web/Dockerfile`)
- **Caddy auto-TLS needs to reach Let's Encrypt within the first 10 minutes after start** — slow / wrong DNS → certificate failure → Caddy serves HTTP and complains in logs. Always check `docker compose logs caddy` after a fresh customer install
- **`AUTH_TRUST_HOST=true` is required behind Caddy** so auth.js honours `X-Forwarded-Host`. Do NOT set this true if web is exposed directly
- **The migrator container shares the worker image, not the web image.** Reason: web's standalone runtime stage doesn't include the Prisma CLI. The worker stage carries `node_modules` plus the source tree, so `bunx prisma migrate deploy` works
- **`bun install --frozen-lockfile` requires `bun.lock` (not `bun.lockb`).** `bun.lock` is the text format pinned by Bun ≥ 1.2

### Customer-side adjustments (Phase-6 specific)

- Set `APP_HOSTNAME`, `AUTH_HOSTNAME`, `ACME_EMAIL` in `.env`
- Set `AUTH_SECRET` (`openssl rand -base64 32`) and `KEYCLOAK_CLIENT_SECRET` from secrets management
- Tighten CSP if their threat model requires (replace `'unsafe-inline'` with nonces — Next.js middleware change)
- Schedule cron for `make backup` + off-site sync
- Pin image tags to released versions, not `:latest`
- Configure `OTEL_EXPORTER_OTLP_ENDPOINT` (their SaaS or `http://otel-collector:4318` if using the local obs profile)

## Internationalisation (read this before touching user-facing strings)

> **For Claude in a customer project:** the template ships next-intl with `de` and `en` message catalogues. Every user-visible string lives in `apps/web/messages/*.json` — never inline JSX. The `i18n-extractor` subagent finds violations.

### What ships

- `apps/web/src/i18n/locales.ts` — the supported locale union (`de`, `en`)
- `apps/web/src/i18n/request.ts` — server-side resolver: session → cookie → Accept-Language → `defaultLocale`
- `apps/web/messages/de.json` and `apps/web/messages/en.json` — namespaced message catalogues; both files MUST carry the same keys
- `next.config.ts` wraps the config with `createNextIntlPlugin('./src/i18n/request.ts')`
- `app/layout.tsx` provides `NextIntlClientProvider` to the React tree

No subpath routing — URLs stay locale-agnostic. Customer projects opt into `/de`, `/en` later by switching `localePrefix` in next-intl's middleware; deep links survive because the i18n state lives in the session/cookie.

### Hard rules (i18n-specific)

1. **Every user-visible string passes through `useTranslations` (client) or `getTranslations` (server)**. JSX literals like `<h1>Sign in</h1>` are reviewer-blocking. Exceptions: code identifiers, technical IDs, audit-log action names, log lines (Pino is for machines)
2. **Both locale files carry the same keys**. Adding `dashboard.foo` to `en.json` without a matching entry in `de.json` is a defect; the `i18n-extractor` surfaces it
3. **Locale claim from Keycloak wins over cookie**. We trust the customer's IdP — if a user sets their preferred locale in Keycloak, that is the source of truth
4. **Date / number / currency formatting goes through `useFormatter()`** (next-intl), not `Intl.DateTimeFormat` directly. Customer projects benefit from a single locale source

### How to add a string

```tsx
// Server component
import { getTranslations } from 'next-intl/server';
const t = await getTranslations('dashboard');
return <h1>{t('title')}</h1>;

// Client component
'use client';
import { useTranslations } from 'next-intl';
const t = useTranslations('toolbar');
return <button>{t('save')}</button>;
```

Add the new key to **both** `de.json` and `en.json` in the same commit.

### How to add a locale

1. Append the new code to `locales` in `apps/web/src/i18n/locales.ts`
2. Create `apps/web/messages/<code>.json` with the same key tree as the existing files
3. If the locale is also added in Keycloak, set the realm's `supportedLocales` in `deploy/keycloak/realm-export.json` to match — customer admins do this in the Keycloak UI at runtime; the template ships a baseline

## Customer-facing concerns (always consider)

- 12-factor: configuration via environment only
- DSGVO: no telemetry leaves the customer infrastructure unless `OTEL_EXPORTER_OTLP_ENDPOINT` is explicitly set
- Backup: app DB + Keycloak DB + uploaded volumes — document in `customer-install.md`
- Update path: pinned image tags, `prisma migrate deploy` on container start, zero-downtime where possible

## Subagents (`.claude/agents/`)

- `architect` — reviews architectural choices against 12-factor + self-hosting constraints
- `db-migration-reviewer` — checks Prisma migrations for reversibility, indexes, locks
- `security-checker` — auth, secrets, CORS, CSP, headers
- `ops-reviewer` — Compose, healthchecks, backups, update paths, resource limits
- `i18n-extractor` — finds hardcoded strings

## When in doubt

Read `docs/superpowers/specs/2026-05-04-app-template-design.md` — it is the source of truth for design intent.
