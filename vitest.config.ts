import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/': `${resolve(import.meta.dirname, 'apps/web/src')}/`,
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
    globals: false,
    environment: 'node',
    // Integration tests hit a real shared Postgres (per CLAUDE.md). Run files
    // sequentially within a single fork to avoid cross-file collisions on
    // shared rows. v4 moved poolOptions to top-level.
    fileParallelism: false,
    pool: 'forks',
    forks: { singleFork: true },
    testTimeout: 10_000,
    // Stub the production env vars so importing @app/config/env at
    // module-load doesn't trip the fail-fast process.exit. Tests that
    // exercise the schema directly use `parseEnv()`, which is pure.
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      APP_BASE_URL: 'http://localhost:3000',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'postgresql://app:app@localhost:5432/app?schema=public',
      REDIS_URL: 'redis://localhost:6379/0',
      KEYCLOAK_ISSUER: 'http://localhost:8080/realms/app',
      KEYCLOAK_CLIENT_ID: 'app-web',
      KEYCLOAK_CLIENT_SECRET: 'test-secret-not-used',
      AUTH_SECRET: 'test-secret-must-be-at-least-32-chars-long',
      AUTH_URL: 'http://localhost:3000',
      COLLAB_WS_PORT: '3101',
      COLLAB_PUBLIC_URL: 'ws://localhost:3101',
      NOTES_SNAPSHOT_DEBOUNCE_MS: '30000',
    },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/generated/**', '**/.next/**', '**/dist/**'],
    },
  },
});
