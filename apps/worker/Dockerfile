# Multi-stage Bun build for the worker.
#
# Worker is plain TypeScript (no Next bundler), so the runtime stage just
# carries the `node_modules` from `bun install` plus the source. Bun
# executes TS directly — no separate build step.
#
# Reused as the migrator image (Compose overrides CMD to run prisma
# migrate deploy from the same image — keeps the image inventory small).

ARG BUN_VERSION=1.3.13

# ── deps ──────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

# ── prisma-generate ──────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS prisma-generate
WORKDIR /app
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
COPY --from=deps /app /app
RUN bun --filter @app/db generate

# ── runtime ──────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Non-root runtime user
RUN addgroup -S app && adduser -S app -G app

# Bring in dependencies + generated Prisma client + source tree
COPY --from=prisma-generate --chown=app:app /app/node_modules ./node_modules
COPY --from=prisma-generate --chown=app:app /app/package.json ./package.json
COPY --from=prisma-generate --chown=app:app /app/bun.lock ./bun.lock
COPY --chown=app:app apps/worker ./apps/worker
COPY --chown=app:app packages/auth ./packages/auth
COPY --chown=app:app packages/config ./packages/config
COPY --from=prisma-generate --chown=app:app /app/packages/db ./packages/db
COPY --chown=app:app packages/jobs ./packages/jobs
COPY --chown=app:app packages/observability ./packages/observability

USER app
EXPOSE 3100

CMD ["bun", "apps/worker/src/index.ts"]
