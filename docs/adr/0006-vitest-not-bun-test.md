# ADR 0006 — Vitest as default test runner (not `bun test`)

**Status:** Accepted
**Date:** 2026-05-04

## Context

Bun ships a built-in test runner. Vitest is the de-facto standard in the Vite/Next ecosystem.

## Decision

Vitest is the test runner for unit and integration tests. Playwright handles E2E (auth flows). Bun remains the runtime/package manager — Vitest runs under Bun via `bun run vitest`.

## Alternatives considered

- **`bun test`** — fast, native, no extra deps; but DOM/jsdom integration, snapshot ergonomics, and Next.js-specific helpers are not at parity yet
- **Jest** — slower, heavier setup, less ESM-friendly, declining adoption

## Consequences

- One extra dev dependency (`vitest`) and its plugins
- Familiar API for contributors coming from the React ecosystem
- We can revisit when `bun test` matches Vitest's ecosystem

## References

- Spec §2, §9
