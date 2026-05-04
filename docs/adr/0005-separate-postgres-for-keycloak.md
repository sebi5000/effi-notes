# ADR 0005 — Separate Postgres for Keycloak

**Status:** Accepted
**Date:** 2026-05-04

## Context

Keycloak needs a relational database. The application also has its own Postgres database.

## Decision

Two Postgres containers: `postgres-app` (application schema) and `postgres-keycloak` (Keycloak schema). Independent volumes, credentials, backups.

## Alternatives considered

- **Shared Postgres, separate schemas** — less RAM, but Keycloak's aggressive schema-migration churn on major upgrades risks locking the app DB and complicates backups

## Consequences

- ~150 MB extra RAM, one extra volume — negligible on customer hardware
- Backup, restore, upgrade procedures are independent and simpler to reason about
- Failure modes are isolated: Keycloak issue does not impact app DB integrity

## References

- Spec §2 ("Aufgelöste Tradeoffs"), §4
