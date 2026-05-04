# ADR 0001 — Use Bun as the production runtime

**Status:** Accepted
**Date:** 2026-05-04

## Context

The template needs a JavaScript runtime for both the Next.js app and a separate worker process. The candidates are Node.js, Deno, and Bun.

## Decision

Bun (≥ 1.3.13) is the production runtime for **both** `apps/web` and `apps/worker`. No Node.js fallback in production images.

## Alternatives considered

- **Node.js 22 LTS** — most ecosystem maturity, longest battle testing, but slower install + cold start
- **Deno** — strong security model, but Node-API compatibility gaps and smaller ecosystem
- **Bun** — fast install, fast startup, native TypeScript, npm compatibility ~98%, BullMQ + Prisma + Next.js officially support it

## Consequences

**Positive**
- Sub-second install in CI and Compose builds
- Lower memory footprint per service
- Native TypeScript execution removes a build step for the worker

**Negative / risks**
- Some `@opentelemetry/auto-instrumentations-node` modules are Node-specific — see ADR 0016
- Long-running process behavior (>72 h) less proven than V8 — mitigated by healthcheck memory threshold + watchdog (Phase 6)
- Niche native addons may not work — accept and document case by case

## References

- Spec: `docs/superpowers/specs/2026-05-04-app-template-design.md` §2
- Bun runtime guide: <https://bun.com/docs/runtime>
