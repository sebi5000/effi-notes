# app-template

Production-ready Next.js + Bun monorepo template for B2B applications. Single-tenant, customer-self-hosted via Docker Compose, vendor-supported remotely.

## Quickstart (local dev, < 5 minutes)

Prerequisites:
- [Bun](https://bun.com) ≥ 1.3.13 — `brew tap oven-sh/bun && brew install bun`
- Docker + Docker Compose v2

```bash
git clone <this-repo> app-template && cd app-template
cp .env.example .env.local       # fill in DATABASE_URL, AUTH_SECRET, etc.
make install                      # bun install + lefthook + prisma generate
make up-dev                       # postgres, postgres-keycloak, keycloak, redis (host ports exposed)
make dev                          # apps/web on :3000  (separate terminal: make dev-worker)
```

For a full production-shaped run with web, worker, and migrator inside Compose:

```bash
make smoke                        # builds + brings up + verifies endpoints + backup roundtrip
```

## Repository layout

```
apps/
├── web/                Next.js 16 application (UI + Route Handlers)
└── worker/             Bun worker process for BullMQ jobs

packages/
├── auth/               auth.js v5 config + RBAC helpers (Role union, hasRole, requireRole)
├── config/             Zod-validated environment + flags
├── db/                 Prisma 7 schema (User, AuditLog) + audit helper + seed
├── jobs/               BullMQ queue definitions + producer + Redis connection
├── observability/      OpenTelemetry SDK init + Pino logger + withSpan helper
└── ui/                 Shared shadcn/ui components

deploy/
├── caddy/              Caddyfile + security-headers snippet
├── compose/            docker-compose.yml + dev / smoke overrides
├── grafana/            Provisioned datasources + Application Overview dashboard
├── keycloak/           Default realm export + customisation README
├── loki/               Loki single-binary config
├── otel-collector/     Pipelines: traces→tempo, logs→loki, metrics→prometheus
├── prometheus/         Prometheus scrape config + OTLP receiver
├── scripts/            backup.sh, restore.sh, smoke.sh
└── tempo/              Tempo single-binary config

docs/
├── architecture.md         C4 L1+L2 diagrams, sequence flows
├── operations.md           Vendor runbook (debugging, updates, incidents)
├── customer-install.md     Customer admin guide (first install, post-setup, troubleshooting)
├── adr/                    21 architecture decision records
└── superpowers/specs/      Original design spec
```

## Common commands

| Command | Description |
|---|---|
| `make install` | Install workspace deps + lefthook hooks + Prisma client |
| `make dev` | Start `apps/web` dev server on :3000 |
| `make dev-worker` | Start `apps/worker` (BullMQ + Bull Board on :3100) |
| `make typecheck` | TypeScript across all 8 packages |
| `make lint` | Biome + Next ESLint |
| `make format` / `make check` | Biome format / combined check + autofix |
| `make test` | Vitest |
| `make up` / `make up-dev` / `make up-obs` | Compose stack (default / dev ports / obs profile) |
| `make logs` / `make ps` / `make down` | Compose lifecycle |
| `make db-migrate-dev` / `make db-seed` / `make db-studio` | Prisma workflows |
| `make smoke` | Full end-to-end smoke test (build + up + verify) |
| `make backup` / `make restore DIR=...` | Snapshot / restore both databases + Redis |

`make help` lists every target.

## Stack at a glance

| Layer | Choice | ADR |
|---|---|---|
| Runtime | Bun 1.3 (production + dev) | [0001](docs/adr/0001-bun-as-production-runtime.md) |
| Frontend | Next.js 16 + React 19 + Tailwind v4 | [0017](docs/adr/0017-nextjs-16-not-15.md) |
| DB | PostgreSQL 16 + Prisma 7 (rust-free, `runtime = "bun"`) | — |
| Auth | Keycloak 26 LTS + auth.js v5 | [0003](docs/adr/0003-keycloak-as-identity-provider.md) [0011](docs/adr/0011-keycloak-version-26-lts.md) |
| Jobs | BullMQ 5 + ioredis (Redis with `noeviction`) | [0018](docs/adr/0018-redis-noeviction-policy.md) |
| Observability | OpenTelemetry → Loki / Tempo / Prometheus / Grafana | [0008](docs/adr/0008-prometheus-not-mimir.md) [0016](docs/adr/0016-otel-instrumentation-allow-list.md) |
| Reverse proxy | Caddy 2 (auto-TLS) | [0007](docs/adr/0007-caddy-not-traefik.md) [0012](docs/adr/0012-tls-via-caddy-acme-with-manual-override.md) |
| Tests | Vitest (unit / integration), Playwright (E2E auth) | [0006](docs/adr/0006-vitest-not-bun-test.md) |

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — operational rules per subsystem (auth, jobs, observability, hardening, i18n) — read this when forking
- [`docs/architecture.md`](docs/architecture.md) — system architecture (C4 L1+L2 + sequence diagrams)
- [`docs/operations.md`](docs/operations.md) — runbook for the vendor (us)
- [`docs/customer-install.md`](docs/customer-install.md) — install guide for customer admins
- [`docs/adr/`](docs/adr/) — 21 architecture decision records
- [`docs/superpowers/specs/2026-05-04-app-template-design.md`](docs/superpowers/specs/2026-05-04-app-template-design.md) — original spec, design intent

## Forking for a customer project

1. `git clone` and rename the repo
2. Re-license: replace `UNLICENSED` in `package.json` with the engagement's license
3. Read [`CLAUDE.md`](CLAUDE.md) end-to-end — it documents every extension point and the rules for modifying each subsystem
4. Add domain entities to `packages/db/prisma/schema.prisma`; the template ships only `User` and `AuditLog`
5. Customer projects own their roles — extend the `Role` union in `packages/auth/src/types.ts` and the realm export
6. CI image registry defaults to GHCR; switch in `.github/workflows/build-images.yml` if needed

The template stays generic. If something domain-specific lands in the template, it is a defect.

## License

UNLICENSED — proprietary, customer projects fork and re-license.
