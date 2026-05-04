# ADR 0007 — Caddy as reverse proxy (not Traefik)

**Status:** Accepted
**Date:** 2026-05-04

## Context

The stack needs a reverse proxy for TLS termination, HTTP→HTTPS, and routing to `web` and (optionally) Grafana / Bull-Board.

## Decision

Caddy v2 with automatic HTTPS via Let's Encrypt. Customer admins get a single, terse `Caddyfile` they can read.

## Alternatives considered

- **Traefik** — more knobs, label-driven config tightly coupled to Compose, larger learning curve for operators
- **Nginx + cert-manager script** — manual renewal, more moving parts
- **HAProxy** — overkill for HTTP-only single-instance setups

## Consequences

- Default Caddyfile assumes outbound 443 to ACME servers is allowed
- Air-gapped customers use a manual-cert override, documented in `customer-install.md` (see ADR 0012)
- Loss of Traefik's discovery features — acceptable since the topology is static

## References

- Spec §4, §11
