# Customer install guide

This document is for the **customer admin** team responsible for hosting an instance of the application on their own infrastructure. The vendor team supports remotely once the install is up.

## Server requirements

| Resource | Minimum (single-server) | Recommended |
|---|---|---|
| CPU | 4 cores | 8 cores |
| Memory | 8 GB | 16 GB |
| Disk | 60 GB SSD | 200 GB SSD with daily off-site snapshots |
| OS | Linux x86_64 with systemd (Ubuntu 24.04 LTS, Debian 12, RHEL 9) | same |
| Docker | Engine 27+ with Compose v2 | latest stable |
| Network | Outbound 443 (ACME, image pulls, optional OTLP forward) | + inbound 443 from end users; ports 80/443 only |
| DNS | Two A records: `app.<your-domain>`, `auth.<your-domain>` pointing to the host | same |

Air-gapped sites: see "Air-gapped install" below.

## Prerequisites

1. Provision the host per the table above
2. Install Docker Engine and Docker Compose v2 from your distribution's package manager
3. Open inbound TCP 80 and 443 in your firewall (no other ports need public exposure)
4. Set DNS A records for `app.<your-domain>` and `auth.<your-domain>`. Confirm propagation with `dig app.<your-domain>`
5. Configure outbound TLS to `acme-v02.api.letsencrypt.org` and `ghcr.io` (image pulls)

## First-time install

### 1. Pull the template

The vendor will provide the repo URL and an image-pull token for GHCR.

```bash
git clone https://<vendor-org>/app-template.git /opt/app-template
cd /opt/app-template
```

### 2. Configure secrets

Copy `.env.example` to `.env` and fill in the required values.

```bash
cp .env.example .env
```

Required values (Compose enforces presence via `${VAR:?required}` — missing values fail `docker compose up` loudly, before any container starts):

| Variable | How to set it |
|---|---|
| `APP_HOSTNAME` | `app.<your-domain>` |
| `AUTH_HOSTNAME` | `auth.<your-domain>` |
| `ACME_EMAIL` | Email that receives Let's Encrypt notifications |
| `REGISTRY` | The image registry the vendor publishes to (e.g. `ghcr.io/<vendor-org>`) |
| `IMAGE_TAG` | The release tag the vendor told you to deploy (e.g. `v1.4.0`) |
| `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD`, `POSTGRES_APP_DB` | App database credentials. Pick anything; rotate the password through `make backup → password change → restore` later if it leaks |
| `POSTGRES_KEYCLOAK_USER`, `POSTGRES_KEYCLOAK_PASSWORD`, `POSTGRES_KEYCLOAK_DB` | Same for Keycloak's database |
| `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` | Used **once** to create the master-realm admin. Replace via the Keycloak UI on first login |
| `KEYCLOAK_CLIENT_SECRET` | After step 4 below: copy from Keycloak's Credentials tab |
| `AUTH_SECRET` | 32+ random bytes — `openssl rand -base64 32` |
| `DATABASE_URL` | `postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres-app:5432/${POSTGRES_APP_DB}?schema=public` (must match the Postgres credentials above) |
| `GRAFANA_ADMIN_PASSWORD` | Required only if you enable the obs profile |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Leave empty unless you opted into vendor-side observability |

### 3. Pull images and start the stack

```bash
docker compose -f deploy/compose/docker-compose.yml pull
docker compose -f deploy/compose/docker-compose.yml up -d
```

Caddy obtains its TLS certificate on first start. Watch for it:

```bash
docker compose -f deploy/compose/docker-compose.yml logs -f caddy
```

A successful certificate provisioning logs `certificate obtained successfully`. If you see ACME failures, the most common cause is DNS not pointing at the host or a firewall blocking outbound 443.

### 4. Configure Keycloak

Open `https://auth.<your-domain>` in a browser. The bootstrap admin (login `admin`, password `admin`) appears on first start. **Change it immediately** under *Master realm → Users → admin → Credentials*.

Switch to the `app` realm.

#### Rotate the client secret

*Clients → app-web → Credentials → Regenerate Secret*. Copy the new value into `.env` (`KEYCLOAK_CLIENT_SECRET`), then restart web and worker:

```bash
docker compose -f deploy/compose/docker-compose.yml up -d web worker
```

#### Delete the default test user

*Users → test@example.invalid → Delete*. The realm export ships this user for vendor-side dev only — it MUST not exist on a production install.

#### Set up SMTP for password resets

*Realm settings → Email*. Point at your transactional mail provider. Send a test email.

#### Optional: federate to your existing IdP

*Identity Providers* (for SAML / OIDC like Azure AD, Okta) or *User Federation* (for LDAP / AD). Once federation is configured, your users sign in with their existing credentials and Keycloak provisions them into the `app` realm.

#### Tighten TLS in production

Edit the realm via *Realm settings → General* and set *SSL Required* to `all` (default `external`). The Compose definition keeps Keycloak's hostname strict-mode off; for production switch the `keycloak` service's command from `start-dev` to `start` and set `KC_HOSTNAME=auth.<your-domain>`.

### 5. Verify

- `https://app.<your-domain>` loads the home page
- `https://app.<your-domain>/login` redirects to Keycloak, you authenticate, you land on `/dashboard`
- `https://app.<your-domain>/api/health/ready` returns `{"status":"ok"}`

If any step fails, see the *Troubleshooting* section.

### 6. Schedule backups

Add a cron job for the host that runs `make backup` daily, then ships the resulting `./backups/<timestamp>/` directory off-site to your storage of choice (S3, MinIO, restic to a remote, rclone to NextCloud, etc.). Off-site replication is **not** included in the template — the data scope is your choice.

Example crontab entry:

```
30 2 * * * cd /opt/app-template && make backup >> /var/log/app-template-backup.log 2>&1
35 2 * * * rclone sync /opt/app-template/backups remote:app-backups
```

Verify the restore path quarterly: pick a backup, restore it on a staging host, log in. A backup you have not tested is hope, not a backup.

## Updates

When the vendor announces a new release:

1. Run a fresh backup: `make backup`
2. Pull the new images: `docker compose -f deploy/compose/docker-compose.yml pull`
3. Apply: `docker compose -f deploy/compose/docker-compose.yml up -d`. The migrator service applies any pending Prisma migrations before web and worker start with the new code
4. Verify: `https://app.<your-domain>/api/health/ready` returns `{"status":"ok"}`

If migrations are destructive, the release notes will say so — schedule a maintenance window before applying.

## Optional: enable the observability stack

To run Loki / Tempo / Prometheus / Grafana locally (no data leaves your host):

```bash
docker compose -f deploy/compose/docker-compose.yml --profile obs up -d
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` in `.env` so apps ship telemetry to the local stack. Restart `web` and `worker`.

Grafana lives at `http://<host>:3001` (in dev) — add a real ingress through Caddy if you want it accessible remotely.

## Air-gapped install

Two adjustments:

1. **TLS**: replace Caddy's auto-ACME with manual certificates. In `deploy/caddy/Caddyfile`, comment out the auto-TLS block and uncomment the `tls /etc/caddy/certs/...` lines. Mount your certs via a Compose volume
2. **Image distribution**: pre-pull the images on a connected host (`docker save`), transfer the tarball, `docker load` on the air-gapped host. Pin specific tags in `.env` and reuse the workflow

## Troubleshooting

### Caddy fails ACME

- DNS not pointing at the host yet? `dig app.<your-domain>` should match the host's public IP
- Firewall blocking outbound 443 to Let's Encrypt? `curl -v https://acme-v02.api.letsencrypt.org/directory` from the host
- Hostname in `.env` typo? `docker compose logs caddy | grep "obtaining certificate"`

### Web is unhealthy

- `docker compose logs web | tail -100` — look for Zod validation errors at boot (means a required env var is missing or malformed)
- `docker compose logs migrator | tail -50` — did migrations succeed? If the migrator failed, web does not start

### Login redirects in a loop

- The `app-web` client's redirect URIs in Keycloak still contain `localhost`. Edit them to include `https://app.<your-domain>/api/auth/callback/keycloak`
- `AUTH_TRUST_HOST` not set to `true` in `.env`? auth.js needs this when behind a proxy

### Where to look first

| Symptom | First file to read |
|---|---|
| Misconfigured env | `docker compose logs web | head -20` (Zod errors) |
| Migration broke | `docker compose logs migrator` |
| TLS broken | `docker compose logs caddy` |
| Slow page | Grafana → Application Overview, or `docker compose stats` |
| Job stuck | Bull Board at `/admin/queues` (requires `ops` role) |

If you cannot resolve in 30 minutes, contact the vendor support team with:

- A description of what you tried
- `docker compose logs --no-color > logs.txt`, sent securely

The vendor's runbook covers the rest.

## Glossary

- **Realm** (Keycloak): a logical security boundary holding users, clients, and roles
- **Client** (Keycloak): an application that authenticates against the realm. Our `app-web` client is the Next.js app
- **Migrator**: a one-shot Compose service that applies Prisma migrations on every `up`
- **Bull Board**: the admin UI for inspecting BullMQ queues, mounted at `/admin/queues` and gated to users with the `ops` role
- **OTLP**: OpenTelemetry Protocol — the wire format the apps use to ship logs / traces / metrics
