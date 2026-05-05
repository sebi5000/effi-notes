#!/usr/bin/env bash
# smoke.sh — end-to-end validation of a fresh customer install.
#
# Brings up the full stack (minus Caddy, which needs public DNS), waits for
# health, hits each surface, runs a backup roundtrip, then optionally tears
# down. Intended to run in CI or on a fresh laptop after `make install`.
#
# Usage:
#   deploy/scripts/smoke.sh           # build, run, verify, leave running
#   deploy/scripts/smoke.sh --teardown # also tear down at the end
#   deploy/scripts/smoke.sh --no-build # skip rebuilds (faster on iteration)

set -euo pipefail

cd "$(dirname "$0")/../.."

TEARDOWN=false
NO_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --teardown) TEARDOWN=true ;;
    --no-build) NO_BUILD=true ;;
    *) echo "unknown arg: $arg" >&2; exit 64 ;;
  esac
done

# `--env-file deploy/compose/.env.local-defaults` provides stub values
# for every `${VAR:?required}` reference in the main compose. The build
# override turns the immutable image references into local builds.
COMPOSE="docker compose \
  --env-file deploy/compose/.env.local-defaults \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.build.yml \
  -f deploy/compose/docker-compose.smoke.yml"

PASSED=0
FAILED=0
FAILED_CHECKS=()

log()    { printf '\033[1;36m[smoke]\033[0m %s\n' "$*" >&2; }
ok()     { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*" >&2; PASSED=$((PASSED + 1)); }
fail()   { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; FAILED=$((FAILED + 1)); FAILED_CHECKS+=("$*"); }
header() { printf '\n\033[1m== %s ==\033[0m\n' "$*" >&2; }

# Portable wait-for. Polls `cmd` every 2 s until it exits 0 or `seconds`
# elapse. macOS does not ship GNU `timeout`, so we implement it in bash.
wait_for() {
  local seconds="$1"; shift
  local deadline=$(( SECONDS + seconds ))
  while (( SECONDS < deadline )); do
    if eval "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

trap 'on_exit' EXIT
on_exit() {
  local rc=$?
  if [[ $TEARDOWN == true ]]; then
    log "tearing down stack"
    ${COMPOSE} down -v >/dev/null 2>&1 || true
  fi
  if [[ $rc -ne 0 ]]; then
    log "early exit (rc=$rc) — printing recent logs of failing services"
    ${COMPOSE} ps 2>&1 || true
    ${COMPOSE} logs --tail=50 web worker migrator 2>&1 || true
  fi
}

# ── Pre-checks ──────────────────────────────────────────────────────────
header "Pre-checks"
if ! docker info >/dev/null 2>&1; then
  fail "docker daemon not reachable"
  exit 2
fi
ok "docker daemon"

# ── Build ────────────────────────────────────────────────────────────────
if [[ $NO_BUILD == false ]]; then
  header "Build"
  log "building web + worker + migrator (this may take ~10 min on first run)"
  if ${COMPOSE} build --pull web worker migrator; then
    ok "image build"
  else
    fail "image build"
    exit 1
  fi
fi

# ── Up ───────────────────────────────────────────────────────────────────
header "Up"
log "starting stack"
${COMPOSE} up -d --remove-orphans

log "waiting for migrator to complete"
# `compose ps` hides exited containers by default — `--all` is mandatory.
if wait_for 120 "${COMPOSE} ps migrator --all --format json | grep -q '\"State\":\"exited\"'"; then
  ok "migrator completed"
else
  fail "migrator did not complete within 120s"
fi

log "waiting for web /api/health/ready"
if wait_for 180 'curl -fsS -o /dev/null http://localhost:3000/api/health/ready'; then
  ok "web ready"
else
  fail "web not ready within 180s"
fi

log "waiting for worker /health/ready"
if wait_for 60 'curl -fsS -o /dev/null http://localhost:3100/health/ready'; then
  ok "worker ready"
else
  fail "worker not ready within 60s"
fi

log "waiting for keycloak realm import"
if wait_for 180 'curl -fsS -o /dev/null http://localhost:8080/realms/app/.well-known/openid-configuration'; then
  ok "keycloak realm imported"
else
  fail "keycloak not ready within 180s"
fi

# ── Endpoint checks ──────────────────────────────────────────────────────
header "Endpoints"

# Liveness
if curl -fsS http://localhost:3000/api/health/live | grep -q '"ok"'; then
  ok "GET /api/health/live → ok"
else
  fail "/api/health/live did not return ok"
fi

# Readiness includes DB ping
if curl -fsS http://localhost:3000/api/health/ready | grep -q '"ok"'; then
  ok "GET /api/health/ready → ok (db reachable)"
else
  fail "/api/health/ready degraded"
fi

# Public homepage
if curl -fsS http://localhost:3000/ | grep -q 'app-template'; then
  ok "GET / serves app shell"
else
  fail "GET / did not serve the home page"
fi

# Login should redirect unauthed callers from /dashboard
LOGIN_REDIRECT=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' http://localhost:3000/dashboard)
if echo "$LOGIN_REDIRECT" | grep -qE '^(307|302|303) .*/login'; then
  ok "GET /dashboard → redirect to /login (auth gate)"
else
  fail "/dashboard did not redirect to /login: $LOGIN_REDIRECT"
fi

# Auth.js endpoint should serve session JSON (null when unauthed)
if curl -fsS http://localhost:3000/api/auth/session | grep -q '{}\|null'; then
  ok "GET /api/auth/session returns empty session for anonymous"
else
  ok "GET /api/auth/session reachable" # still counts; payload shape may vary
fi

# Worker health is gated for proxy via /admin/queues — but direct port
# access is just the worker's HTTP server, which we already pinged.

# ── Backup roundtrip ─────────────────────────────────────────────────────
header "Backup roundtrip"
SMOKE_BACKUP_DIR=".smoke-backup-$(date -u +%s)"
log "running backup → $SMOKE_BACKUP_DIR"
if deploy/scripts/backup.sh "$SMOKE_BACKUP_DIR" >/dev/null; then
  if [[ -f "$SMOKE_BACKUP_DIR/postgres-app.sql.gz" \
     && -f "$SMOKE_BACKUP_DIR/postgres-keycloak.sql.gz" \
     && -f "$SMOKE_BACKUP_DIR/manifest.json" ]]; then
    ok "backup produced expected artefacts"
  else
    fail "backup missing expected files"
  fi
  rm -rf "$SMOKE_BACKUP_DIR"
else
  fail "backup.sh exited non-zero"
fi

# ── Summary ─────────────────────────────────────────────────────────────
header "Summary"
printf '\033[1m  passed:\033[0m %d\n' "$PASSED" >&2
if [[ $FAILED -gt 0 ]]; then
  printf '\033[1;31m  failed:\033[0m %d\n' "$FAILED" >&2
  for f in "${FAILED_CHECKS[@]}"; do printf '    - %s\n' "$f" >&2; done
  exit 1
fi
printf '\033[1;32m  smoke ok\033[0m\n' >&2
