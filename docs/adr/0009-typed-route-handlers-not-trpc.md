# ADR 0009 — Typed Route Handlers + Zod (no tRPC)

**Status:** Accepted
**Date:** 2026-05-04

## Context

The template needs an internal API style for the web app to talk to its own backend.

## Decision

Plain Next.js Route Handlers with Zod-validated bodies and a thin typed-fetch helper that infers types from Zod schemas. **No tRPC**.

## Alternatives considered

- **tRPC** — excellent end-to-end types, but introduces its own conventions, version churn, and an extra abstraction layer that the template would force on every customer project
- **GraphQL (Yoga / Pothos)** — too heavy for the template; cache invalidation and schema design are project-specific concerns
- **OpenAPI generation** — useful when exposing API to third parties, irrelevant for the template's internal-only consumer

## Consequences

- API surface stays close to web standards; less to learn for new contributors
- Type safety relies on careful sharing of Zod schemas between server and client — pattern documented in `apps/web`
- Customer projects can adopt tRPC themselves if they have a use case

## References

- Spec §2, §9
