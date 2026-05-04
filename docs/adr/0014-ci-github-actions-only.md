# ADR 0014 — CI provider: GitHub Actions only

**Status:** Accepted
**Date:** 2026-05-04

## Context

The template needs CI for build, test, container build, and image scanning. Source-of-truth lives on GitHub.

## Decision

GitHub Actions is the **only** CI configuration shipped in the template (`.github/workflows/`). Customer projects that need a different provider port the workflows themselves.

## Alternatives considered

- **GitLab CI / Forgejo / Drone** — duplicating workflow definitions adds maintenance burden with no benefit to current customers
- **Make targets only** — runs on local laptops fine but no automated gating

## Consequences

- The `prepare` script and `make install` flow stay close to GitHub Actions reality
- Customers self-hosting Forgejo/GitLab adapt the workflows per project, documented as a known concern

## References

- Spec §14 Q5
