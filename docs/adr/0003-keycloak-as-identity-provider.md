# ADR 0003 — Keycloak as identity provider

**Status:** Accepted
**Date:** 2026-05-04

## Context

Customers need SSO, often integrating with their existing AD/LDAP/SAML/OIDC IdPs. Building auth ourselves is out of scope and a security liability.

## Decision

Keycloak (self-hosted in the Compose stack) is the IdP. The Next.js app integrates via auth.js v5 (`@auth/core`) using the OIDC Authorization Code flow with PKCE.

## Alternatives considered

- **Auth0 / Clerk / WorkOS** — SaaS, customer data leaves the box, contradicts the self-hosting promise
- **Ory Hydra/Kratos** — capable but two services to operate; more YAML; no realm-level admin UI for the customer
- **Roll our own** — no

## Consequences

- Keycloak realm becomes the source of truth for identity
- Customer can federate with their existing IdP via Keycloak's provider config
- We ship a default realm export as a starting point — see `deploy/keycloak/`
- Keycloak adds an extra service + its own DB (see ADR 0005)

## References

- Spec §6, §3
