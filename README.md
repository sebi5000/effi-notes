# app-template

Production-ready Next.js + Bun monorepo template for B2B applications. Single-tenant, customer-self-hosted via Docker Compose, vendor-supported remotely.

## Quickstart (local dev, < 5 minutes)

Prerequisites:
- [Bun](https://bun.com) ≥ 1.3.13 — `brew tap oven-sh/bun && brew install bun`
- Docker + Docker Compose v2 _(needed from Phase 2 onward — Postgres, Redis, Keycloak)_

```bash
git clone <this-repo> app-template && cd app-template
cp .env.example .env.local
make install
make dev          # http://localhost:3000
```

Until Phase 2 lands, the stack is just an empty Next.js shell — no database, no auth, no jobs.

## Repository layout

```
apps/web         → Next.js 16 application (UI + Route Handlers)
apps/worker      → Bun worker process for BullMQ jobs
packages/db      → Prisma schema + generated client
packages/config  → Zod-validated environment + central config
packages/observability → OpenTelemetry + Pino setup
packages/auth    → auth.js config + RBAC helpers
packages/ui      → Shared shadcn/ui components
deploy/          → Compose, Caddy, Grafana, Prometheus, Keycloak, scripts
docs/            → Architecture, operations, customer install, ADRs
```

## Common commands (via `make`)

| Command          | Description                              |
|------------------|------------------------------------------|
| `make install`   | Install workspace deps + lefthook hooks  |
| `make dev`       | Start `apps/web` dev server              |
| `make dev-worker`| Start `apps/worker`                      |
| `make typecheck` | TypeScript check across all packages     |
| `make lint`      | Biome + Next ESLint                      |
| `make format`    | Biome format                             |
| `make check`     | Biome combined check with autofix        |
| `make test`      | Run all tests                            |
| `make build`     | Build all packages                       |

`make help` lists every target.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system architecture (C4 L1+L2)
- [`docs/operations.md`](docs/operations.md) — runbook for the vendor (us)
- [`docs/customer-install.md`](docs/customer-install.md) — install guide for customer admins
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design specs

## Status

Phase 1 of 8 — skeleton. See `docs/superpowers/specs/2026-05-04-app-template-design.md` for the full plan.

## License

UNLICENSED — proprietary, customer projects fork and re-license.
