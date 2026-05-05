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
