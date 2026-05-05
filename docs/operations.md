# Operations runbook (vendor-internal)

This document is for **us** — the vendor team supporting customer installs remotely. The customer-facing equivalent is [`customer-install.md`](customer-install.md).

## Quick reference

| Need | Command (run on customer host) |
|---|---|
| Stack status | `make ps` |
| Logs (all services) | `make logs` |
| Restart everything | `make down && make up` |
| Apply pending migrations | `make db-migrate` |
| Open psql against the app DB | `docker compose exec postgres-app psql -U app app` |
| Backup before maintenance | `make backup` |
| Restore from backup | `make restore DIR=./backups/<timestamp>` |
| Tail logs of one service | `docker compose logs -f --tail=200 web` |
| Shell into web | `docker compose exec web sh` |
| Inspect Redis (BullMQ state) | `docker compose exec redis redis-cli` |

## Standard customer update workflow

1. **Prerequisite check** — confirm current image tags with the customer admin (`docker compose images`). Confirm an off-site backup is < 24 h old
2. **Snapshot** — `make backup` creates a fresh local snapshot. Keep the directory name handy
3. **Pin the new tag** — update `IMAGE_TAG` in the customer's `.env` (or wherever they store it). Do not edit the Compose YAML in place
4. **Pull** — `docker compose pull` pulls only the changed images
5. **Up** — `docker compose up -d`. The migrator runs first; web + worker swap once migrations succeed. Compose health-checks them; rollouts that fail health stay on the previous image because Compose does not auto-promote unhealthy containers
6. **Verify** — `curl https://${APP_HOSTNAME}/api/health/ready` returns `{"status":"ok"}`. Ops user opens `/dashboard`, triggers a demo job, sees it complete in Bull Board
7. **Document** — add the upgrade timestamp + version to the customer's record. If the release notes mention destructive migrations, note the maintenance window

If step 5 fails: `docker compose logs migrator` shows the migration error. The previous web/worker keep serving (they were running from the old image until the migrator succeeds). Roll back by reverting the `IMAGE_TAG`. **Never** roll back schema changes blindly — read the migration first.

## Debugging a customer issue

### "The site is slow"

1. `docker compose stats` — quick view of CPU / memory per service. Web at 100% CPU = expensive page; worker at 100% = job storm
2. Open Grafana (if `--profile obs` is on): the Application Overview dashboard's HTTP latency p95 panel surfaces sudden regressions. The Prisma query duration panel surfaces N+1 queries
3. Tempo: search for slow traces (`duration > 1s`) for the affected route. Click into one — the spans show where time went (DB? external HTTP? Keycloak refresh?)
4. Loki: `{service_name="app-web"} | json | level="warn"` — look for log lines that correlate with the slowness

### "I can't log in"

1. Loki: `{service_name="app-web"} | json | component="auth.callback"` — does the callback even fire? If not, the issue is at Keycloak / browser
2. Loki: `{service_name="app-web"} | json | level=~"error|warn"` — token refresh failures show up as `RefreshAccessTokenError`
3. `docker compose exec keycloak kc.sh show-config | head -40` — confirm Keycloak is on the right hostname
4. Browser DevTools: the cookie set by auth.js is `__Secure-authjs.session-token` (production) or `authjs.session-token` (dev). Missing → CSRF / cookie-domain issue
5. Rate limit? `docker compose exec redis redis-cli KEYS 'rl:auth.*'` — if a client hit the limit, this returns the IP keys

### "Jobs are stuck in `waiting`"

1. Bull Board (`/admin/queues`) — confirm
2. `docker compose logs --tail=200 worker | grep -i error` — worker crashing on startup?
3. `docker compose ps worker` — restart loop?
4. Worker not connected to Redis? `docker compose exec worker sh -c 'wget -O - http://localhost:3100/health/ready'` — the readiness probe pings Redis
5. Lock contention? Long-running job exceeded `lockDuration`. Check the per-queue config in `packages/jobs/src/queues.ts`

### "Audit log is missing entries"

The audit helper is **opt-in** (Phase 2 design). It is called explicitly from server actions / route handlers. If a customer expected an event to be audited and it was not, that is by design — point them at the relevant call site and ask if they want it audited.

## Pulling logs from a customer

Two options:

1. **OTLP forward (preferred)** — customer sets `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.<vendor-domain>:4318` in their `.env`. Their stack ships logs / traces / metrics to our backend (Grafana Cloud, Datadog, your-observability-of-choice). Subject to AVV terms — never default-on
2. **Bundle dump** — for one-off issues: `docker compose logs --no-color > customer-logs.txt && tar czf logs-$(date -u +%FT%TZ).tar.gz customer-logs.txt`. Customer transfers via their preferred mechanism (NextCloud, ProtonDrive, etc.)

Always confirm scope with the customer's data-protection officer before pulling logs that contain user identifiers.

## Update path for the template itself

When *we* ship a new template version (image bump, ADR-driven change):

1. Land changes on `main` with a Changesets entry
2. CI's `release.yml` opens / updates a release PR
3. Merging the release PR cuts a SemVer tag
4. `build-images.yml` builds + scans (Trivy) + pushes `app-template-web` and `app-template-worker` to GHCR
5. We notify customers via release notes (in their support portal). Each customer schedules their upgrade per their own change-management

## Incident response

### Severity 1 — customer cannot log in / cannot serve

- **First action**: open a video call with the customer's ops contact. Get a screen share of `make logs`
- **Triage in 5 minutes**: which service is unhealthy? `make ps` → `docker compose logs <unhealthy-service>`
- **Mitigations to try in order**: restart the unhealthy service (`docker compose restart <svc>`); restart the whole stack (`make down && make up`); roll back to the previous image tag from the most recent backup
- **Communicate**: every 15 min update the customer with what you tried and what the next step is, even if it is "still investigating"

### Severity 2 — degraded but functional

- Open a ticket on our side
- Schedule a maintenance window with the customer for the fix
- Do not hot-fix in production unless the user-visible degradation is severe

### Postmortem

For every Sev-1 and any Sev-2 caused by our code: write a postmortem within 5 working days. Save it under our internal docs (not in this template) — include: timeline, root cause, contributing factors, mitigations applied, prevention plan. Link the relevant ADR if behaviour changes are warranted.

## Volume hygiene

- `docker compose down` keeps volumes; safe to run
- `docker compose down -v` **deletes volumes** — that is a customer data-loss event. Never run on a customer host
- The Makefile does not include a `down -v` target by design

## Secrets rotation

| Secret | When to rotate | How |
|---|---|---|
| `AUTH_SECRET` | On compromise; otherwise every 12 months | `openssl rand -base64 32` → update `.env` → `docker compose up -d web worker` |
| `KEYCLOAK_CLIENT_SECRET` | On compromise; otherwise every 6 months | Rotate in Keycloak admin (`Clients → app-web → Credentials → Regenerate Secret`) → update `.env` → restart web + worker |
| Database passwords | On compromise; otherwise rare | Coordinated maintenance window: change in postgres + `.env` simultaneously |
| Keycloak admin password | On compromise; otherwise every 6 months | Keycloak admin UI |

Rotations are documented per customer in their record so we know what is in play.
