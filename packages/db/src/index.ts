import { env } from '@app/config/env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client.ts';

/**
 * Single Prisma client per process. Reused across requests.
 *
 * The adapter pattern (Prisma 7) lets the rust-free client speak Postgres
 * via the `pg` driver — required for the `runtime = "bun"` generator.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
});

export const prisma = new PrismaClient({ adapter });

export type { PrismaClient } from '../generated/client.ts';
