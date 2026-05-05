# Multi-stage Bun build for the worker.
#
# Worker is plain TypeScript — no Next bundler, Bun executes TS directly.
# We carry the full workspace tree (source + node_modules) into runtime
# because Bun resolves `@app/*` workspace deps via symlinks under
# node_modules/@app/, which only stay valid relative to the original
# packages/ directory layout. Slicing the tree across stages breaks the
# resolver, so we keep it whole.
#
# Image is reused as the migrator (Compose overrides CMD to run prisma
# migrate deploy).

ARG BUN_VERSION=1.3.13

# ── deps + prisma generate ───────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY . .
# --ignore-scripts skips the lefthook prepare hook (no .git in build context).
RUN bun install --frozen-lockfile --ignore-scripts
# DATABASE_URL placeholder for Prisma's config loader (env() resolves at parse time).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
RUN bun --filter @app/db generate

# ── runtime ──────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Non-root runtime user
RUN addgroup -S app && adduser -S app -G app

# Copy the entire workspace tree as-is. This preserves the relative
# paths that Bun's workspace symlinks rely on.
COPY --from=deps --chown=app:app /app /app

USER app
EXPOSE 3100

CMD ["bun", "apps/worker/src/index.ts"]
