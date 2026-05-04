# ADR 0010 — Image registry: GHCR

**Status:** Accepted
**Date:** 2026-05-04

## Context

Customer Compose stacks need to pull versioned container images. We need a registry that integrates with our CI and supports private images.

## Decision

GitHub Container Registry (`ghcr.io`). Images tagged with both the SemVer release (`v1.2.3`) and the git SHA. Latest tag only on the `dev` channel.

## Alternatives considered

- **Docker Hub** — rate limits on anonymous pulls, less integrated with GitHub Actions
- **Customer-hosted registry** — possible per-engagement, but not the default for the template
- **AWS ECR / GAR** — vendor lock-in, complicates customer self-host model

## Consequences

- CI workflow assumes a `GITHUB_TOKEN` with `packages: write` scope
- Customer pulls images using a deploy token we provision per engagement
- Air-gapped customers can mirror images to their own registry — documented later

## References

- Spec §14 Q1
