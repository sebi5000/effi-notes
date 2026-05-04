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

- Package names: `@app/web`, `@app/worker`, `@app/db`, `@app/config`, `@app/observability`, `@app/auth`, `@app/ui`
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
