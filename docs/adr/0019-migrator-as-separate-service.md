# ADR 0019 — Run `prisma migrate deploy` from a dedicated migrator service

**Status:** Accepted
**Date:** 2026-05-05

## Context

Production updates pull new images (`web`, `worker`) that may carry new Prisma migrations. We need to apply migrations exactly once per deploy, before either app starts serving with code that expects the new schema. Several patterns exist:

1. Migrate from web's container entrypoint (run `migrate:deploy` then exec next start)
2. Migrate by hand via `docker compose exec web bun prisma migrate deploy` after `up`
3. A dedicated one-shot `migrator` service that web depends on via `service_completed_successfully`

## Decision

Pattern 3. The Compose stack defines a `migrator` service that uses the worker image with overridden `command`. It runs once on `up`, exits 0, and `web` + `worker` depend on it via `service_completed_successfully`.

## Alternatives considered

- **Migrate-from-web-entrypoint**: simple but races when scaling out web replicas (multiple replicas attempt the migration simultaneously). Prisma's migration locking helps but is not zero-cost. Also conflates two concerns in one log stream
- **Manual exec**: works but is forgettable, and breaks zero-downtime promises when an admin forgets to run it

## Consequences

**Positive**
- Deploys are atomic: migrator either succeeds (then apps start) or fails loudly (apps never start with the new code, restart loops are obvious)
- One log stream per concern — migrations have their own container and exit code
- Web replicas scale freely; migrator runs once regardless of replica count
- The same image carries migrate, generate, and worker runtime — small image inventory

**Negative / risks**
- Stack startup is a tiny bit slower (migrator must complete first). Mitigated by Postgres's already-fast migration apply
- Customers running web behind a different orchestrator (k8s) need to translate the pattern themselves — out of scope for the template

## References

- Spec §4
- Compose docs on `service_completed_successfully`: <https://docs.docker.com/compose/compose-file/05-services/#depends_on>
