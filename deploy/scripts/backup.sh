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

# Compose interpolates `${VAR:?required}` against either the customer's
# `.env` at repo root (its default lookup) or, if that file is absent
# (CI / fresh dev clones), our local-defaults. Pass `--env-file` only
# when there is no customer .env — otherwise we'd shadow real values.
COMPOSE_ENV_FILE_ARG=""
if [[ ! -f .env ]]; then
  COMPOSE_ENV_FILE_ARG="--env-file deploy/compose/.env.local-defaults"
fi

# `docker compose exec` is enough for DB dumps — it talks to running
# containers by service name without needing volume-path knowledge.
# Project name comes from Compose's ambient context (COMPOSE_PROJECT_NAME
# or the parent directory). Never hardcode `app-template_*`.
COMPOSE="docker compose ${COMPOSE_ENV_FILE_ARG} -f deploy/compose/docker-compose.yml"

TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
TARGET_DIR="${1:-./backups/${TIMESTAMP}}"
mkdir -p "${TARGET_DIR}"

log() { printf '[backup] %s\n' "$*" >&2; }

# ── Postgres app DB ───────────────────────────────────────────────────────
log "dumping postgres-app → ${TARGET_DIR}/postgres-app.sql.gz"
# pg_dump reads $POSTGRES_USER and $POSTGRES_DB from the container's env,
# which we set from POSTGRES_APP_USER/DB at compose time — so backup
# tracks whatever credentials the customer chose without hardcoding.
${COMPOSE} exec -T postgres-app sh -c \
  'pg_dump --username="$POSTGRES_USER" --format=plain --no-owner --no-privileges --clean --if-exists "$POSTGRES_DB"' \
  | gzip > "${TARGET_DIR}/postgres-app.sql.gz"

# ── Postgres keycloak DB ──────────────────────────────────────────────────
log "dumping postgres-keycloak → ${TARGET_DIR}/postgres-keycloak.sql.gz"
${COMPOSE} exec -T postgres-keycloak sh -c \
  'pg_dump --username="$POSTGRES_USER" --format=plain --no-owner --no-privileges --clean --if-exists "$POSTGRES_DB"' \
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
