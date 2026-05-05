# Multi-stage Bun + Next.js standalone build.
#
# Build context = repo root. Reason: Bun workspaces need every workspace
# package.json reachable for `bun install` to resolve `workspace:*`.
#
# Customer projects extend layers (e.g. add a step to bundle private
# fonts, or copy domain-specific assets). Don't change the stage names —
# they are referenced by name from CI image-build pipelines.

ARG BUN_VERSION=1.3.13

# ── deps ──────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app

# Copy the manifest set first for layer caching. We copy the whole repo
# (instead of cherry-picking package.json files) because Bun workspaces
# require the directory layout to be intact at install time.
COPY . .
# --ignore-scripts skips the `prepare` lifecycle (lefthook install). The
# build context has no .git directory (.dockerignore excludes it), so
# lefthook would fail. Local dev installs run lefthook via `make install`.
RUN bun install --frozen-lockfile --ignore-scripts

# ── build ────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Build-time placeholders. `next build` collects page data, which
# imports @app/config/env and runs Zod validation. None of these values
# are used at runtime — they are overwritten by the customer's .env at
# `up` time. Keep them syntactically valid (URLs, 32+ char AUTH_SECRET).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV REDIS_URL="redis://localhost:6379/0"
ENV KEYCLOAK_ISSUER="http://localhost:8080/realms/build"
ENV KEYCLOAK_CLIENT_ID="build"
ENV KEYCLOAK_CLIENT_SECRET="build"
ENV AUTH_SECRET="build-time-placeholder-32-bytes-or-more"
ENV AUTH_URL="http://localhost:3000"

COPY --from=deps /app /app

RUN bun --filter @app/db generate \
 && bun --filter @app/web build

# ── runtime ──────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root runtime user
RUN addgroup -S app && adduser -S app -G app

# Standalone output already contains the minimal server + node_modules.
# Static and public assets are not bundled and must be copied separately.
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public

USER app
EXPOSE 3000

# Bun runs the Node-style standalone server. The path preserves the
# monorepo layout because `output: 'standalone'` keeps it that way.
CMD ["bun", "apps/web/server.js"]
