# ADR 0021 — Rate limiting lives in the app, backed by Redis

**Status:** Accepted
**Date:** 2026-05-05

## Context

The auth endpoints (`/api/auth/*`) are obvious targets for credential-stuffing and brute-force attacks. We need a rate-limit layer that:

- Throttles per source IP (and optionally per user)
- Survives across multiple web replicas (when a customer scales horizontally)
- Returns standard `429 Too Many Requests` with a `Retry-After` header
- Can be extended to other scopes (export endpoints, expensive operations) without re-architecting

## Decision

Implement the rate limiter in Next.js (`apps/web/src/lib/rate-limit.ts`) using Redis sorted sets as a sliding window. The auth catch-all route wraps `handlers.GET` / `handlers.POST` with a 30-req/min/IP guard. Customer projects extend by calling `rateLimit({ key, scope, max, windowMs })` from any route handler.

## Alternatives considered

- **`caddy-ratelimit` plugin** — works well but requires building a custom Caddy image with `xcaddy`, which pushes more ops surface to customer admins. Default `caddy:alpine` does not include it
- **In-memory limiter** (e.g. `lru-cache`) — fast but per-replica. Two web replicas means double the effective limit, and a load balancer with sticky-IP routing would still allow round-robin bypass
- **Cloud SaaS WAF** — layer too far for a self-host template; customers add it on top if they have it

## Consequences

**Positive**
- One Redis already provisioned (BullMQ); no extra moving parts
- Correctly shared across web replicas via Redis
- Per-route, per-user, per-feature limits are trivial to add (`scope` parameter)
- Standard `429` + `Retry-After` headers; clients honour them automatically

**Negative / risks**
- A Redis outage disables rate limiting (fail-open). Acceptable: the alternative (fail-closed) blocks all auth traffic on a Redis hiccup, which is worse for the customer
- Per-request overhead is one Redis round trip (~1 ms within the same Compose host). Acceptable for the auth path
- IP detection relies on `X-Forwarded-For` from Caddy; setting `AUTH_TRUST_HOST=true` is required and is documented in CLAUDE.md

## References

- ADR 0007 — Caddy as reverse proxy (and why we don't fork it for plugins)
- Spec §6
- Caddy ratelimit plugin (for customer projects that prefer L7): <https://github.com/mholt/caddy-ratelimit>
