# B2B App-Template – Design & Phase-0-Plan

**Datum:** 2026-05-04
**Status:** Entwurf zum Review
**Owner:** Sebastian Essling

---

## 1. Zweck und Scope

Produktionsreifes Projekt-Template für individuelle B2B-Software, das als Basis für Kundenprojekte dient. Das Template wird vom Anbieter entwickelt und gewartet, beim Kunden via Docker Compose auf dessen Servern deployed. Single-Tenant pro Kunde, eigene DB, eigenes Keycloak-Realm. Wir supporten remote, der Kunde betreibt nur die Hardware.

**Im Scope:** Skelett mit Auth, Health, Jobs, Observability, i18n, Audit-Log-Tabelle, Feature-Flag-Stub.
**Nicht im Scope:** Fachliche Entitäten, CRUD-Beispiele, dekorative Dashboard-Widgets.

## 2. Stack-Entscheidungen (verbindlich)

| Schicht | Wahl | Begründung |
|---|---|---|
| Runtime | Bun (auch Prod) | User-Vorgabe; geprüft: Next 15, Prisma, BullMQ, OTel laufen 2026 produktiv unter Bun |
| Frontend | Next.js 16 App Router + Tailwind v4 + shadcn/ui | User-Vorgabe (auf 16 angehoben da 16.2.4 Latest in 05/2026) |
| Backend | Next.js Route Handlers + separater Bun-Worker | User-Vorgabe |
| DB | PostgreSQL 16 + Prisma | User-Vorgabe; rust-freier `prisma-client`-Generator mit `runtime = "bun"` |
| Auth | Keycloak (self-hosted) + `auth.js` mit Keycloak-Provider | User-Vorgabe |
| Jobs | BullMQ + Redis 7 | User-Vorgabe; BullMQ supportet Bun offiziell |
| Observability | OTel SDK → OTLP → Grafana/Loki/Tempo/Prometheus | User-Vorgabe |
| Reverse Proxy | Caddy | User-Vorgabe |
| Test (Unit/Integration) | Vitest | Bessere Next/jsdom-Integration als `bun test` |
| Test (E2E) | Playwright | Auth-Flows |
| API-Style | Getypte Route Handlers + Zod, **kein tRPC** | YAGNI für Template; tRPC kann Kunde nachziehen |
| API-Schema-Validierung | Zod (alle Boundaries: Env, Bodies, Job-Payloads) | User-Vorgabe |
| Linter/Formatter | Biome + ESLint (Next-Plugin) | Biome formatiert, ESLint lintet Next-Spezifika |
| Pre-commit | Lefthook | User-Vorgabe |
| Versionsverwaltung | Conventional Commits + Changesets | User-Vorgabe |
| CI | GitHub Actions Stub | build, test, container-build, trivy-scan |

### Aufgelöste Tradeoffs

- **Keycloak-DB:** Eigene Postgres-Instanz (`postgres-keycloak`), getrennt von der App-DB. Begründung: aggressive Schema-Migrationen bei Keycloak-Major-Upgrades, getrennte Backup-/Restore-Pfade, klarer Blast-Radius. Kosten ~150 MB RAM, ein Volume mehr.
- **Metriken-Backend:** Prometheus (Single-Binary). Mimir ist für Multi-Tenant-Scale-out – nicht relevant bei Single-Tenant-Kundeninstallationen. Falls zentrale Aggregation nötig wird, geht das via OTLP-Push zu unserer Infrastruktur.
- **Bull-Board:** Eingebaut hinter Auth-Middleware unter `/admin/queues`, nur für Rolle `ops` (Mapping aus Keycloak-Claim).

## 3. Repo-Struktur (Bun Workspaces)

```
.
├── apps/
│   ├── web/                 # Next.js 15
│   └── worker/              # Bun-Worker für BullMQ
├── packages/
│   ├── db/                  # Prisma-Schema, Migrations, generierter Client
│   ├── config/              # Zod-Env-Schema, zentrale Config
│   ├── observability/       # OTel-Setup, Logger
│   ├── auth/                # auth.js-Konfig + RBAC-Helper (web)
│   └── ui/                  # shadcn-Komponenten
├── deploy/
│   ├── compose/             # docker-compose.yml + .dev.yml + .prod.yml + .obs.yml
│   ├── caddy/               # Caddyfile-Templates
│   ├── grafana/             # Dashboards, Datasources, Alerting
│   ├── prometheus/          # Scrape-Config
│   ├── otel-collector/      # Collector-Config
│   ├── keycloak/            # Realm-Export als Startwert + Themes-Stub
│   └── scripts/             # Backup, Restore, Smoke-Test
├── docs/
│   ├── architecture.md
│   ├── operations.md        # Betriebshandbuch (für uns)
│   ├── customer-install.md  # Anleitung Kunden-Admin
│   ├── adr/                 # Architecture Decision Records
│   └── superpowers/specs/
├── .github/workflows/
├── .claude/                 # Subagents, CLAUDE.md
├── package.json             # Workspaces-Definition
├── tsconfig.base.json
├── biome.json
├── lefthook.yml
├── Makefile                 # make install / make up / make logs / make smoke
└── README.md
```

**Erweiterung gegenüber dem Vorschlag aus der Anforderung:**
- `packages/auth` extrahiert, damit Route Handlers, Middleware und Server Components dieselben RBAC-Helfer nutzen ohne Cross-Import aus `apps/web`
- `deploy/caddy`, `deploy/prometheus`, `deploy/otel-collector` als eigene Verzeichnisse (vorher unter `compose/`)
- `deploy/scripts` für Backup/Restore/Smoke-Test
- `Makefile` als einheitliche Schnittstelle (Quickstart-Ziel)

## 4. Compose-Topologie

Drei Profile aktivierbar via `--profile`:

```
default  → web, worker, postgres-app, postgres-keycloak, redis, keycloak, caddy
obs      → otel-collector, grafana, loki, tempo, prometheus
dev      → ergänzt postgres-Ports nach außen, lockerere CORS, hot-reload
```

### Netzwerksegmentierung

- `net-edge` – Caddy ↔ web (nur Caddy hat Port 80/443 nach außen)
- `net-app` – web ↔ worker ↔ keycloak
- `net-data` – web/worker/keycloak ↔ postgres-app/postgres-keycloak/redis (kein Port-Mapping nach außen außer in `dev`-Profil)
- `net-obs` – alle Apps ↔ otel-collector → loki/tempo/prometheus → grafana

### Pflicht pro Service

- Healthcheck (`healthcheck:` Block)
- `restart: unless-stopped`
- `mem_limit` und `cpus` (sinnvolle Defaults pro Service)
- Read-only-Filesystem wo möglich, mit Tmpfs für Cache
- `user:` non-root
- Nur explizit benötigte Volumes
- Logging-Driver mit `max-size`/`max-file`

### Volumes

- `vol-postgres-app`, `vol-postgres-keycloak`, `vol-redis-data`, `vol-grafana`, `vol-loki`, `vol-tempo`, `vol-prometheus`, `vol-caddy-data`, `vol-caddy-config`

## 5. Datenmodell (Prisma, Phase 2)

```prisma
model User {
  id            String   @id @default(cuid())
  keycloakSub   String   @unique          // OIDC sub claim
  email         String   @unique
  displayName   String?
  locale        String   @default("de")
  roles         String[]                  // gespiegelt aus Keycloak
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  lastSeenAt    DateTime?
  auditLogs     AuditLog[]
}

model AuditLog {
  id         String   @id @default(cuid())
  occurredAt DateTime @default(now())
  actorId    String?
  actor      User?    @relation(fields: [actorId], references: [id])
  action     String                       // z.B. "user.login"
  subject    String?                      // betroffene Entität
  metadata   Json?
  ipAddress  String?
  userAgent  String?

  @@index([occurredAt])
  @@index([actorId, occurredAt])
}
```

**Entitäten-Scope (Template):** Nur `User` und `AuditLog`. Keine fachlichen Entitäten — die kommen pro Kundenprojekt.

**Feature-Flags:** Env-basiert über `packages/config` (`FEATURE_X=true`). Keine eigene Tabelle; ein Kundenprojekt kann das auf eine DB-Tabelle / externen Service heben, falls Runtime-Toggling nötig wird.

## 6. Auth-Flow (Phase 3)

- Keycloak-Container startet mit Realm-Import aus `deploy/keycloak/realm-export.json`
- Default-Realm: `app` mit Default-Client `app-web` (Confidential, Authorization Code Flow + PKCE)
- Default-Rollen: `user`, `admin`, `ops`
- Default-Test-User in `dev`-Profil, in `prod`-Profil leer
- `auth.js` mit Keycloak-Provider, Token-Refresh via Refresh-Token, Sessions als JWE-Cookies
- Beim ersten Login: Upsert auf `User` via `keycloakSub`
- Geschützte Route: `/dashboard`. Public: `/`, `/api/health/*`
- Worker hat keine Session-Auth: Web-Prozess pusht Jobs direkt an Redis im isolierten `net-data`. Job-Payloads enthalten `actorId` + Trace-Context; Worker validiert nur Schema (Zod) und protokolliert via OTel

## 7. Observability-Architektur (Phase 5)

```
[web] ┐                            ┌→ [loki]   (logs)
      ├──OTLP/gRPC──→ [collector] ─┼→ [tempo]  (traces)
[worker] ┘                          └→ [prometheus] (metrics)
                                         ↓
                                     [grafana]
```

### Spezifika unter Bun

- OTel-Init **programmatisch** in `instrumentation.ts` (Next 15 Hook) und am Eintritt des Worker-Prozesses, **nicht** via `--require`
- `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` – nicht-funktionale Instrumentations einzeln deaktivierbar
- Prisma-Tracing via `@prisma/instrumentation`
- BullMQ-Tracing via OTel-Conventions (manuell via `tracer.startActiveSpan` um Job-Processing)
- Pino als Logger mit OTel-Trace-Context-Injection
- Default-Dashboards mitgeliefert: HTTP-Latenz, Job-Queue-Tiefe, DB-Slow-Queries, Error-Rate

### Toggle

- `OTEL_EXPORTER_OTLP_ENDPOINT` leer → keine Exports, Stack läuft trotzdem
- `OBS_PROFILE=on` → `obs`-Profil im Compose aktiv, Grafana lokal verfügbar
- Beides unabhängig konfigurierbar

## 8. i18n (Phase 1, leer aber funktional)

- `next-intl` mit Routing über Subpath (`/de`, `/en`)
- `messages/de.json`, `messages/en.json` mit nur den Keys, die das Skelett braucht (Login, Dashboard, Errors)
- Locale-Detection: User-Profil > Cookie > `Accept-Language`
- Subagent `i18n-extractor` (Phase 7) findet Hardcoded-Strings später

## 9. Engineering-Standards

- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- Zod an allen Außengrenzen (Env, Route-Handler-Inputs, Job-Payloads, externe API-Responses)
- Prisma-Migrations versioniert, **niemals** `db push` in Prod, Migration-Workflow `prisma migrate deploy` im Container-Entrypoint
- Pre-commit (lefthook): typecheck, biome format+lint, eslint, vitest --changed, prisma format
- CI-Pipeline: build, typecheck, lint, vitest, playwright (smoke), docker build, trivy scan, changesets check
- Conventional Commits, automatischer CHANGELOG via Changesets
- Image-Tags: SemVer + Git-SHA. Latest-Tag nur dev.
- `.env.example` vollständig, `.env.local` gitignored, Schema in `packages/config` validiert beim Boot und failed-fast

## 10. Subagents (`.claude/agents/`)

Werden nicht über Superpowers ersetzt, sondern als projekt-spezifische Reviewer ergänzt:

- `architect` – reviewt Architekturentscheidungen gegen 12-Factor und Self-Hosting-Constraints
- `db-migration-reviewer` – prüft Prisma-Migrationen auf Reversibilität, fehlende Indizes, Locking-Verhalten unter Last
- `security-checker` – prüft Auth, Secrets, CORS, CSP, Headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- `ops-reviewer` – prüft Compose, Healthchecks, Backup, Update-Pfad, Resource-Limits
- `i18n-extractor` – findet Hardcoded-Strings

## 11. Dokumentation

- `README.md` – Quickstart < 5 min lokal lauffähig
- `docs/operations.md` – für uns: Update-Workflow beim Kunden, Logs ziehen, Debugging, Incident-Playbook
- `docs/customer-install.md` – für Kunden-Admin: Server-Anforderungen, TLS, Backups, Update-Anleitung, was sie bei uns melden
- `docs/architecture.md` – C4-L1+L2 als Mermaid
- `docs/adr/` – mind.: Bun-Wahl, Single-Tenant, Keycloak, Compose-statt-K8s, getrennte Keycloak-DB, Vitest-statt-bun-test, Caddy-statt-Traefik, Prometheus-statt-Mimir, kein-tRPC

## 12. Phasen-Plan

| Phase | Inhalt | Akzeptanzkriterium |
|---|---|---|
| **0** | Plan (= dieses Dokument) | User-Approval |
| **1** | Skelett: Workspaces, leere Apps, TS-Config, Lint, Pre-commit, Makefile, `.env.example`, ADR-Stubs | `bun install && bun dev` startet leere Next-App auf :3000 |
| **2** | Daten: Prisma-Schema (User, AuditLog), Migrations-Setup, `db`-Package, Postgres im Compose, Seed-Skript, Audit-Helper (nicht verdrahtet) | `make db-migrate && make db-seed` läuft, User-CRUD im Prisma Studio sichtbar |
| **3** | Auth: Keycloak + eigene Postgres im Compose, Realm-Export, auth.js v5, geschützte `/dashboard`, `/login`, Logout, User-Upsert, RBAC-Helper, Health-Endpoints | Login mit Test-User → Dashboard, Logout → Public-Page; User-Datensatz in DB; CLAUDE.md dokumentiert alle Extension-Points |
| **4** | Jobs: Redis im Compose, BullMQ, `@app/jobs`-Package, Worker mit Demo-Queue + Bun.serve für Bull Board, `/admin/queues` Auth-Proxy in web | Demo-Job über Dashboard auslösbar, ops-User sieht Bull Board hinter `/admin/queues`, Worker-Logs strukturiert |
| **5** | Observability: OTel-SDK in web+worker (allow-list per ADR 0016), `@app/observability` mit Pino+Trace-Inject, `withSpan` Helper, manuelle Span-Wrappung im Demo-Processor, Collector + Loki + Tempo + Prometheus + Grafana im obs-Profil, Application-Overview-Dashboard | Login-Trace in Tempo, Job-Span am Trace hängend, Logs in Loki mit trace_id, Queue-Depth-Metrik in Prom, Default-Dashboard auto-provisioned |
| **6** | Härtung: Multi-stage Bun-Dockerfiles für web+worker, Compose-Services für web/worker/migrator/caddy, Caddyfile mit ACME-Auto-TLS + Manuell-Cert-Override + Security-Header-Snippet, Redis-backed Rate-Limit auf `/api/auth/*`, Backup/Restore-Skripte, ADRs 0019-0021 | Compose syntax-valid mit allen Profiles, Dockerfiles und Caddyfile reviewable, Backup-Skripte ausführbar |
| **7** | Dokumentation und ADRs | Alle Docs aus §11 fertig, ADRs gemerged |
| **8** | Validierung: frischer Clone → `make install && make up` auf macOS und Linux | Smoke-Skript grün, Login-Flow funktioniert ohne Manual-Intervention |

Nach jeder Phase: kurzer Statusbericht (was läuft, offene Punkte), dann auf Go warten.

## 13. Bekannte Risiken und Mitigations

| Risiko | Impact | Mitigation |
|---|---|---|
| OTel-Auto-Instrumentation für Bun ist Node-fokussiert; nicht alle Instr-Libs laufen | Mittel | Programmatische Init, Instrumentationen einzeln zuschaltbar, Liste der getesteten in ADR |
| Bun-Memory-Verhalten bei Long-Running-Worker (>72 h) noch weniger erprobt als Node | Mittel | Healthcheck mit Memory-Schwelle, Watchdog-Restart bei Drift, Monitoring-Alarm |
| Prisma `runtime = "bun"` ist neuere Code-Pfad | Niedrig | Auf Prisma ≥ 6 pinnen, in CI gegen Bun + Node testen (Node nur als Vergleich) |
| Keycloak-Major-Upgrades brechen Realm-Schema | Mittel | Pinned Image-Tag, Realm-Export bei Update neu generieren, Test im Staging |
| Caddy automatisches TLS bei air-gapped Kunden | Mittel | Doku: Modus für eigenes Zertifikat (`tls /path/cert /path/key`) im Caddyfile-Template |
| BullMQ-Performance unter Bun Bottleneck am Redis-Client, nicht Runtime | Niedrig | Default-Config getuned, Redis-Connection-Pool dokumentiert |

## 14. Offene Fragen (vor Phase 1)

1. **Image-Registry:** GHCR (öffentliche Privatable) oder eigene? Wirkt sich auf CI-Workflow aus.
2. **Keycloak-Version:** Pinning auf `26.x` LTS ok, oder wollt ihr aktuelles Major mitziehen?
3. **TLS beim Kunden:** Default Caddy-Auto (Let's Encrypt) – ist erlaubt, dass Server mit ACME ins Internet darf? Falls nicht: Default umschalten auf manuelle Certs.
4. **Backup-Ziel:** Skript-Stub schreibt nach `/var/backups/app/` lokal. Möchtet ihr ein S3-/MinIO-Upload-Stub direkt mitliefern oder bleibt das pro Kundenprojekt?
5. **CI-Provider:** GitHub Actions wurde genannt – fixiert? Oder GitLab/Forgejo als Alternative dokumentieren?
6. **Lizenz:** Welche Lizenz steht im Repo (proprietär, MIT, etc.)?
7. **`@opentelemetry/auto-instrumentations-node` Bun-Schwarzliste:** In Phase 5 testen wir je Instr-Lib; wollt ihr eine vorab fixierte Whitelist (HTTP, PG, Redis, Pino) und Rest aus, oder iterativ aufschalten?

## 15. Definition of Done für das Template insgesamt

- Frischer Clone → `make install && make up` läuft auf macOS (Apple Silicon + Intel) und Linux (x86_64)
- Login-Flow mit Test-User funktioniert ohne manuelle Schritte
- Demo-Job läuft durch und ist in Grafana sichtbar
- Backup-Restore-Roundtrip funktioniert
- Alle Docs aus §11 vorhanden, lesbar, akkurat
- Trivy-Scan ohne Critical/High-Findings
- Pre-commit-Hooks blockieren Commits mit Lint-/Type-Fehlern
- ADRs für alle nichttrivialen Entscheidungen vorhanden
