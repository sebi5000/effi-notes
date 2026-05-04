# ADR 0016 — OpenTelemetry instrumentation allow-list

**Status:** Accepted
**Date:** 2026-05-04

## Context

`@opentelemetry/auto-instrumentations-node` includes ~30 instrumentation modules. Some are Node-specific and break under Bun; some hook into libraries we do not use; loading all of them grows the boot graph and surface area.

## Decision

We enable a **fixed allow-list**, not the auto-set:

- `@opentelemetry/instrumentation-http` (HTTP client + server)
- `@opentelemetry/instrumentation-pg` (Postgres)
- `@opentelemetry/instrumentation-ioredis` (Redis client we use with BullMQ)
- `@opentelemetry/instrumentation-pino` (log-trace correlation)
- `@opentelemetry/instrumentation-undici` (Next.js fetch path)
- `@prisma/instrumentation` (Prisma queries — tied to Prisma version)

BullMQ tracing is **manual** (we wrap job processing with `tracer.startActiveSpan`) because the upstream auto-instrumentation is incomplete.

## Alternatives considered

- **`getNodeAutoInstrumentations()` enable-all** — broke under Bun in our smoke testing; pulls in instrumentations for libs we never use
- **No auto, hand-roll everything** — too much code for marginal benefit

## Consequences

- New library = explicit decision whether to add an instrumentation, captured in PR review
- Bun-incompatible instrumentations stay out of the build
- Phase 5 wires this allow-list in `packages/observability`

## References

- Spec §14 Q7, §7, §13
- OneUptime guide: <https://oneuptime.com/blog/post/2026-02-06-opentelemetry-bun-without-nodejs-require-flag/view>
