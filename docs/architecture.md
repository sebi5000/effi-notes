# Architecture

System view of the app template. Diagrams are [C4](https://c4model.com/) Level 1 (system context) and Level 2 (containers). Component-level diagrams cover the parts the template ships — auth flow, job flow, observability flow.

## L1 — System context

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart LR
  user(("End user<br/>(customer staff)"))
  vendor(("Vendor (us)<br/>support team"))
  customer(("Customer admin<br/>operations team"))

  app["app-template instance<br/>(per customer, self-hosted)"]
  acme["Let's Encrypt<br/>ACME"]
  vendor_obs[(Vendor observability<br/>backend, optional)]

  user -- "HTTPS<br/>Sign in, use features" --> app
  customer -- "SSH / Docker<br/>install, update, backup" --> app
  vendor -- "Logs / traces / metrics<br/>(only if customer opts in)" --> vendor_obs
  app -. "OTLP push<br/>(optional)" .-> vendor_obs
  app <-. "TLS cert renewal" .-> acme

  classDef external fill:#f3f4f6,stroke:#9ca3af;
  class acme,vendor_obs external;
```

**Boundaries.** One **deployment per customer** (single tenant per ADR 0002). Customer hardware hosts everything. We never receive customer data unless they explicitly forward telemetry to our observability backend (`OTEL_EXPORTER_OTLP_ENDPOINT`).

## L2 — Containers (Compose services)

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart TB
  subgraph edge[net-edge]
    caddy[caddy<br/>reverse proxy + ACME]
  end

  subgraph app[net-app]
    web[web<br/>Next.js 16 standalone]
    worker[worker<br/>Bun + BullMQ + Bull Board]
    keycloak[keycloak<br/>26.x]
  end

  subgraph data[net-data]
    pg_app[(postgres-app)]
    pg_kc[(postgres-keycloak)]
    redis[(redis 7<br/>noeviction)]
    migrator[migrator<br/>one-shot]
  end

  subgraph obs[net-obs (profile: obs)]
    otel[otel-collector]
    loki[(loki)]
    tempo[(tempo)]
    prom[(prometheus)]
    grafana[grafana]
  end

  caddy -- "HTTPS" --- web
  caddy -- "HTTPS" --- keycloak

  web -- "OIDC" --> keycloak
  web -- "Prisma" --> pg_app
  web -- "BullMQ producer" --> redis
  web -- "Reverse-proxy<br/>/admin/queues" --> worker
  web -- "OTLP" --> otel

  worker -- "BullMQ consumer" --> redis
  worker -- "Prisma" --> pg_app
  worker -- "OTLP" --> otel

  keycloak --> pg_kc

  migrator -- "prisma migrate deploy<br/>(once on `up`)" --> pg_app

  otel --> loki
  otel --> tempo
  otel --> prom
  prom --> grafana
  loki --> grafana
  tempo --> grafana

  classDef obs fill:#fff7ed,stroke:#fdba74;
  class otel,loki,tempo,prom,grafana obs;
```

**Networks.** Four Compose networks segregate traffic; only `caddy` exposes host ports.

| Network | Members |
|---|---|
| `net-edge` | caddy, web |
| `net-app` | caddy, web, worker, keycloak |
| `net-data` | web, worker, migrator, postgres-app, postgres-keycloak, redis |
| `net-obs` | web, worker, otel-collector, loki, tempo, prometheus, grafana |

## L3 — Auth flow

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant W as web (Next.js)
  participant K as keycloak
  participant DB as postgres-app

  U->>W: GET /dashboard
  W->>W: middleware: no session → redirect /login
  U->>W: GET /login
  U->>W: POST signIn (server action)
  W->>K: 302 Authorization Code + PKCE
  K-->>U: Login form
  U->>K: Credentials
  K-->>W: 302 callback?code=...
  W->>K: Exchange code → access + refresh tokens
  W->>W: jwt callback runs
  W->>DB: upsert User (keycloakSub)
  W-->>U: Set session cookie, redirect /dashboard

  Note over W,K: Refresh on every request needing<br/>session, when access token < 30s remaining.
```

## L3 — Job flow

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant W as web
  participant R as redis (BullMQ)
  participant K as worker
  participant DB as postgres-app

  U->>W: Server action: triggerDemoJob()
  W->>W: rateLimit (Redis sorted set)
  W->>R: enqueueDemoJob (Zod-validated payload)
  R-->>K: BLPOP / consumer event
  K->>K: withSpan('demo.process', ...)
  K->>K: processDemoJob (your code)
  K-->>R: Mark complete (with retention rules)
  Note over W,DB: Optional recordAudit() call from web<br/>writes to audit_log; processor logs via Pino.
```

## L3 — Observability flow

```mermaid
sequenceDiagram
  autonumber
  participant W as web / worker
  participant O as otel-collector
  participant L as loki
  participant T as tempo
  participant P as prometheus
  participant G as grafana

  W->>O: Traces (OTLP gRPC)
  W->>O: Metrics (OTLP HTTP)
  W->>O: Logs (OTLP HTTP via pino-opentelemetry-transport)
  O->>T: forward traces
  O->>L: forward logs
  O->>P: forward metrics (--enable-feature=otlp-write-receiver)

  Note over W,O: trace_id and span_id are injected into Pino<br/>log records by @opentelemetry/instrumentation-pino<br/>so logs and traces correlate in Grafana.

  G-->>P: Query metrics
  G-->>L: Query logs
  G-->>T: Query traces
```

## Source-of-truth boundaries

- **Identity** — Keycloak. Application's `User` table is a mirror keyed by `keycloakSub`
- **Application data** — PostgreSQL (`postgres-app`)
- **Queue state** — Redis (BullMQ); persisted via RDB snapshots in `redis-data`
- **Trace / log / metric data** — Loki / Tempo / Prometheus inside the customer install (or wherever they point `OTEL_EXPORTER_OTLP_ENDPOINT`)
- **Configuration** — Customer's `.env` only; validated via Zod in `@app/config/env`

## Versioning

The template publishes `app-template-web` and `app-template-worker` images to GHCR with SemVer tags + git SHA, linked under the same release version (Changesets). Customer projects fork and re-version per their own SemVer policy. Migrations are forward-only; rollback is "downgrade image + run inverse migration manually" (no auto-rollback).

## See also

- [`docs/operations.md`](operations.md) — runbook for the vendor (us)
- [`docs/customer-install.md`](customer-install.md) — install guide for customer admins
- [`docs/adr/`](adr/) — architecture decision records (decisions with tradeoffs, with full reasoning)
- [`docs/superpowers/specs/2026-05-04-app-template-design.md`](superpowers/specs/2026-05-04-app-template-design.md) — original spec, source of design intent
- [`CLAUDE.md`](../CLAUDE.md) — operational rules per subsystem
