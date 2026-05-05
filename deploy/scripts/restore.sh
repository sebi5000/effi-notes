#!/usr/bin/env bash
# restore.sh — restore the stack from a backup directory.
#
# DESTRUCTIVE — this drops and recreates the app + keycloak databases
# from the dumps. Run only on a paused stack with explicit confirmation.
#
# Usage:
#   deploy/scripts/restore.sh <backup-directory>

set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f deploy/compose/docker-compose.yml"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <backup-directory>" >&2
  exit 64
fi

SOURCE_DIR="$1"
if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "[restore] not a directory: ${SOURCE_DIR}" >&2
  exit 65
fi

log() { printf '[restore] %s\n' "$*" >&2; }

read -r -p "[restore] this will DROP and recreate the app + keycloak databases. Type 'yes' to continue: " confirm
if [[ "${confirm}" != "yes" ]]; then
  log "aborted"
  exit 1
fi

log "stopping web + worker (databases stay up so we can restore)"
${COMPOSE} stop web worker || true

# ── Postgres app ──────────────────────────────────────────────────────────
if [[ -f "${SOURCE_DIR}/postgres-app.sql.gz" ]]; then
  log "restoring postgres-app"
  gunzip -c "${SOURCE_DIR}/postgres-app.sql.gz" \
    | ${COMPOSE} exec -T postgres-app psql --username=app --dbname=app
else
  log "WARNING: postgres-app.sql.gz missing, skipping"
fi

# ── Postgres keycloak ─────────────────────────────────────────────────────
if [[ -f "${SOURCE_DIR}/postgres-keycloak.sql.gz" ]]; then
  log "restoring postgres-keycloak"
  gunzip -c "${SOURCE_DIR}/postgres-keycloak.sql.gz" \
    | ${COMPOSE} exec -T postgres-keycloak psql --username=keycloak --dbname=keycloak
else
  log "WARNING: postgres-keycloak.sql.gz missing, skipping"
fi

# ── Redis ────────────────────────────────────────────────────────────────
# Restoring redis is rarely useful (queues will replay missed jobs from
# the producer side), but we support it for completeness. Stops Redis,
# drops the data file in, and restarts.
if [[ -f "${SOURCE_DIR}/redis-dump.rdb.gz" ]]; then
  read -r -p "[restore] also restore Redis (BullMQ state will revert)? Type 'yes' to confirm: " confirm_redis
  if [[ "${confirm_redis}" == "yes" ]]; then
    log "restoring redis"
    ${COMPOSE} stop redis
    gunzip -c "${SOURCE_DIR}/redis-dump.rdb.gz" \
      | ${COMPOSE} run --rm -T --no-deps -v app-template_redis-data:/data redis sh -c 'cat > /data/dump.rdb'
    ${COMPOSE} start redis
  else
    log "skipping redis restore"
  fi
fi

log "starting web + worker"
${COMPOSE} start web worker

log "restore complete — verify with /api/health/ready and Bull Board"
