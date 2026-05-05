#!/usr/bin/env bash
# backup.sh — snapshot both Postgres databases + Redis dump.
#
# Off-site replication is OUT OF SCOPE per ADR 0013. Customer projects
# add cron + their off-site tool of choice (rclone, restic, borg, …).
#
# Usage:
#   deploy/scripts/backup.sh [target-directory]
#
# Defaults to ./backups/<UTC-timestamp>/. Exits non-zero on any error.

set -euo pipefail

cd "$(dirname "$0")/../.."  # repo root
COMPOSE="docker compose -f deploy/compose/docker-compose.yml"

TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
TARGET_DIR="${1:-./backups/${TIMESTAMP}}"
mkdir -p "${TARGET_DIR}"

log() { printf '[backup] %s\n' "$*" >&2; }

# ── Postgres app DB ───────────────────────────────────────────────────────
log "dumping postgres-app → ${TARGET_DIR}/postgres-app.sql.gz"
${COMPOSE} exec -T postgres-app \
  pg_dump --username=app --format=plain --no-owner --no-privileges --clean --if-exists app \
  | gzip > "${TARGET_DIR}/postgres-app.sql.gz"

# ── Postgres keycloak DB ──────────────────────────────────────────────────
log "dumping postgres-keycloak → ${TARGET_DIR}/postgres-keycloak.sql.gz"
${COMPOSE} exec -T postgres-keycloak \
  pg_dump --username=keycloak --format=plain --no-owner --no-privileges --clean --if-exists keycloak \
  | gzip > "${TARGET_DIR}/postgres-keycloak.sql.gz"

# ── Redis (BullMQ in-flight jobs) ─────────────────────────────────────────
# BGSAVE is non-blocking; we wait briefly and copy the dump.rdb out.
log "snapshotting redis → ${TARGET_DIR}/redis-dump.rdb.gz"
${COMPOSE} exec -T redis redis-cli BGSAVE >/dev/null
sleep 2
${COMPOSE} exec -T redis cat /data/dump.rdb | gzip > "${TARGET_DIR}/redis-dump.rdb.gz"

# ── Manifest ──────────────────────────────────────────────────────────────
{
  echo "{"
  echo "  \"timestamp\": \"${TIMESTAMP}\","
  echo "  \"created_by\": \"deploy/scripts/backup.sh\","
  echo "  \"compose\": \"$(${COMPOSE} version --short 2>/dev/null || echo unknown)\","
  echo "  \"contents\": ["
  ls -1 "${TARGET_DIR}" | sed 's/.*/    "&",/' | sed '$s/,$//'
  echo "  ]"
  echo "}"
} > "${TARGET_DIR}/manifest.json"

log "complete: ${TARGET_DIR}"
log "next: ship this directory off-host (rclone / restic / borg) per ADR 0013"
