# ADR 0013 — Backup target: local filesystem (no S3 stub)

**Status:** Accepted
**Date:** 2026-05-04

## Context

Backups for app DB + Keycloak DB + uploaded volumes need a target. Customers have wildly different storage policies (NAS, S3, MinIO, tape, none).

## Decision

The default backup script writes to `/var/backups/app/` on the host. Off-site replication is **out of scope** for the template — customers add it via cron + their tool of choice.

## Alternatives considered

- **Bundled S3/MinIO upload** — assumes infrastructure we cannot guarantee customers have; pulls in SDKs and credentials handling
- **Restic / Borg integration** — opinionated; some customers ban these tools

## Consequences

- The template ships a working backup-restore roundtrip on local disk (Phase 6)
- Customer-specific off-site replication lives in customer projects
- Operations doc has a "what to back up off-host" section listing the directories

## References

- Spec §14 Q4
