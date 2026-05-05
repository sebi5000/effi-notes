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
RUN bun install --frozen-lockfile

# ── build ────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL is required at build time only because Prisma's config loader
# resolves env() at parse time. The value is never used; Next does not connect
# to the DB during `next build`.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NODE_ENV=production

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
