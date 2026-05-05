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

# Same env-file auto-detect as backup.sh — see comment there.
COMPOSE_ENV_FILE_ARG=""
if [[ ! -f .env ]]; then
  COMPOSE_ENV_FILE_ARG="--env-file deploy/compose/.env.local-defaults"
fi
COMPOSE="docker compose ${COMPOSE_ENV_FILE_ARG} -f deploy/compose/docker-compose.yml"

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
    | ${COMPOSE} exec -T postgres-app sh -c 'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
else
  log "WARNING: postgres-app.sql.gz missing, skipping"
fi

# ── Postgres keycloak ─────────────────────────────────────────────────────
if [[ -f "${SOURCE_DIR}/postgres-keycloak.sql.gz" ]]; then
  log "restoring postgres-keycloak"
  gunzip -c "${SOURCE_DIR}/postgres-keycloak.sql.gz" \
    | ${COMPOSE} exec -T postgres-keycloak sh -c 'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
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
    # Resolve the volume name dynamically — Compose names it
    # <project>_redis-data, where <project> is COMPOSE_PROJECT_NAME or
    # the parent directory. Hardcoding `app-template_*` would break on
    # forks or side-by-side installs.
    VOLUME_NAME="$(${COMPOSE} config --format json 2>/dev/null \
      | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["volumes"]["redis-data"]["name"])')"
    if [[ -z "${VOLUME_NAME}" ]]; then
      log "ERROR: could not resolve redis-data volume name from compose config"
      exit 1
    fi
    ${COMPOSE} stop redis
    gunzip -c "${SOURCE_DIR}/redis-dump.rdb.gz" \
      | ${COMPOSE} run --rm -T --no-deps -v "${VOLUME_NAME}:/data" redis sh -c 'cat > /data/dump.rdb'
    ${COMPOSE} start redis
  else
    log "skipping redis restore"
  fi
fi

log "starting web + worker"
${COMPOSE} start web worker

log "restore complete — verify with /api/health/ready and Bull Board"
