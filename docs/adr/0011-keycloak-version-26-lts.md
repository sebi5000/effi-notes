# ADR 0011 — Keycloak version pinned to 26.x LTS

**Status:** Accepted
**Date:** 2026-05-04

## Context

Keycloak ships frequent majors with database schema migrations. Customers cannot tolerate surprise upgrades.

## Decision

Pin to the latest patch of Keycloak 26.x LTS in `deploy/compose/`. Major upgrades are deliberate, tested in our staging, then released as a minor template version with migration notes.

## Alternatives considered

- **Track latest** — too risky; major upgrades have broken realm imports historically
- **Older LTS (e.g. 25.x)** — falls out of upstream support too soon

## Consequences

- Customers get a stable target for ≥ 1 year
- Major upgrade is a coordinated event with release notes in `CHANGELOG.md`
- Realm export must be regenerated and tested whenever the major changes

## References

- Spec §14 Q2, §13 (risks)
