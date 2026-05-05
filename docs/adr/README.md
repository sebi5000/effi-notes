# Architecture Decision Records

Each non-trivial decision with tradeoffs is captured here. Format follows [MADR](https://adr.github.io/madr/) lite.

## Status values

- **Proposed** — under discussion
- **Accepted** — current direction
- **Deprecated** — no longer current, superseded by another ADR
- **Superseded by ADR-XXXX** — replaced

## Index

| ADR | Title | Status |
|---|---|---|
| 0001 | Use Bun as the production runtime | Accepted |
| 0002 | Single-tenant deployment model | Accepted |
| 0003 | Keycloak as identity provider | Accepted |
| 0004 | Docker Compose as default deploy target (not Kubernetes) | Accepted |
| 0005 | Separate Postgres for Keycloak | Accepted |
| 0006 | Vitest as default test runner (not `bun test`) | Accepted |
| 0007 | Caddy as reverse proxy (not Traefik) | Accepted |
| 0008 | Prometheus as metrics backend (not Mimir) | Accepted |
| 0009 | Typed Route Handlers + Zod (no tRPC) | Accepted |
| 0010 | Image registry: GHCR | Accepted |
| 0011 | Keycloak version pinned to 26.x LTS | Accepted |
| 0012 | TLS via Caddy auto-ACME with manual override | Accepted |
| 0013 | Backup target: local filesystem (no S3 stub) | Accepted |
| 0014 | CI provider: GitHub Actions only | Accepted |
| 0015 | License: UNLICENSED (proprietary template) | Accepted |
| 0016 | OpenTelemetry instrumentation allow-list | Accepted |
| 0017 | Next.js 16 (not 15 as originally specified) | Accepted |
| 0018 | Redis `noeviction` policy for BullMQ | Accepted |
