import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
      // Coverage is enforced on the effi-notes vertical slice — code added
      // for this feature. Pre-existing template scaffolding (health routes,
      // rate-limit module, env loader) is excluded; the editor + shell are
      // covered by Phase E E2E rather than Vitest.
      include: [
        'apps/web/src/app/api/notes/**/route.ts',
        'apps/web/src/app/api/folders/**/route.ts',
        'apps/web/src/app/api/tags/**/route.ts',
        'apps/web/src/app/api/search/route.ts',
        'apps/web/src/app/api/collab/**/route.ts',
        'apps/web/src/lib/api/schemas.ts',
        'apps/web/src/lib/api/responses.ts',
        'apps/web/src/lib/notes/**/*.ts',
        'apps/web/src/components/notes/Sidebar/CommandBar.tsx',
        'apps/web/src/components/notes/Sidebar/FolderTree.tsx',
        'apps/web/src/components/notes/Sidebar/TagCloud.tsx',
        'apps/web/src/components/notes/Editor/PresenceBar.tsx',
        'apps/web/src/components/notes/Editor/SaveIndicator.tsx',
        'apps/worker/src/yjs/**/*.ts',
        'apps/worker/src/processors/notes-snapshot.ts',
        'packages/auth/src/rbac.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/generated/**',
        '**/.next/**',
        '**/dist/**',
        'apps/web/src/lib/api/test-session.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});
