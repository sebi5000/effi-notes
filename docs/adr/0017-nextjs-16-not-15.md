# ADR 0017 — Next.js 16 (not 15 as originally specified)

**Status:** Accepted
**Date:** 2026-05-04

## Context

The original requirement specified Next.js 15. By 2026-05, Next.js 16.2.4 is the latest stable; 15.5.x exists only on the `backport` dist-tag.

## Decision

Pin Next.js to **16.x** (currently 16.2.4). React stays on 19.2.x. App Router is unchanged.

## Alternatives considered

- **Stay on Next 15** — starts the template one major version behind on day one; shorter support runway for customer projects that live for years
- **Track latest aggressively (canary/beta)** — too much instability for a customer-facing template

## Consequences

- Customer projects benefit from the full Next 16 support window
- Migration documentation is up-to-date with current Next docs
- Risk: if we hit a Next-16-specific regression, we triage upstream rather than backport

## References

- Spec §2 (table updated), §13
