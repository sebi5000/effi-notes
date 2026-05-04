# ADR 0015 — License: UNLICENSED (proprietary template)

**Status:** Accepted
**Date:** 2026-05-04

## Context

The template embodies vendor IP. Customer engagements vary in their licensing constraints.

## Decision

Template repo is `UNLICENSED` (proprietary). Customer projects forked from the template re-license to whatever the engagement requires, removing this ADR or superseding it.

## Alternatives considered

- **MIT/Apache** — gives away vendor leverage with no upside
- **AGPL** — strong copyleft signal, but conflicts with closed-source customer projects

## Consequences

- Public sharing of template snippets requires explicit clearance
- Customer fork takes ownership and chooses its license at start of engagement
- Third-party deps remain under their original licenses; we maintain a license inventory in CI later (`license-checker`)

## References

- Spec §14 Q6
