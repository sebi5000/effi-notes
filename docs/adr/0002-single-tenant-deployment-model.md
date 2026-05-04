# ADR 0002 — Single-tenant deployment model

**Status:** Accepted
**Date:** 2026-05-04

## Context

B2B customers run the application on their own infrastructure. We support remotely.

## Decision

Each customer gets a fully isolated stack: own database, own Keycloak realm in their own Keycloak instance, own Compose deployment. **No multi-tenancy concerns** in code or schema.

## Alternatives considered

- **Multi-tenant SaaS** — wrong shape for the GTM (data residency, AVV, customer-owned hardware)
- **Hybrid (multi-tenant code, single-tenant deploy)** — paying complexity tax for an unused feature

## Consequences

- Schema stays simple: no `tenant_id`, no row-level security
- Customer onboarding = provision a server, deploy a stack
- Pricing/licensing per instance, not per seat in our infra
- Update rollouts coordinated per customer

## References

- Spec §2
