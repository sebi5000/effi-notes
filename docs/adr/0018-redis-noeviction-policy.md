# ADR 0018 — Redis `noeviction` policy for BullMQ

**Status:** Accepted
**Date:** 2026-05-05

## Context

BullMQ stores queue state, job records, and bookkeeping (lock keys, scheduling sets, completed/failed lists) in Redis. Under memory pressure, Redis can evict keys based on its `maxmemory-policy`. Default policies (`allkeys-lru`, `volatile-lru`, etc.) treat BullMQ's internal keys as candidates for eviction, which corrupts queue state without raising an error.

## Decision

The `redis` service in Compose runs with `--maxmemory-policy noeviction`. This is non-negotiable for a queue-backed setup. The `--maxmemory` cap (default 256 MB) is tuned per customer based on observed throughput.

The `ioredis` client used by BullMQ (in `packages/jobs/src/connection.ts`) sets `maxRetriesPerRequest: null` and `enableReadyCheck: false`. These are required by BullMQ — without them, a brief Redis hiccup aborts blocking commands and crashes Workers.

## Alternatives considered

- **`allkeys-lru` with separate Redis instance for caching** — viable but doubles operational surface, and we don't ship caching in the template
- **Disable persistence** (`--save ""`) — accepted side benefit on `noeviction` since failed memory writes are loud, but persistence stays on so a Redis restart does not lose in-flight jobs

## Consequences

**Positive**
- Queue state cannot be silently lost
- Operators see explicit OOM errors instead of mysterious lost jobs

**Negative**
- Customer admins must monitor Redis memory and bump `--maxmemory` when usage approaches the cap. Without eviction, exceeding the cap rejects writes (job submissions fail loudly)
- Phase 5 wires a Prometheus alert on Redis memory headroom

## References

- BullMQ docs: <https://docs.bullmq.io/guide/connections>
- Spec §2 — Jobs subsystem
- Spec §13 — risk: BullMQ-Performance under Bun
