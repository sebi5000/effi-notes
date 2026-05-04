import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Workspace root .env files. Bun --filter does not auto-discover env files
// outside the package cwd, so load them explicitly. Order: .env.local wins.
const root = resolve(import.meta.dirname, '../..');
dotenv.config({ path: [resolve(root, '.env.local'), resolve(root, '.env')], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun run prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
