import { z } from 'zod';

/**
 * Single source of truth for environment variables.
 *
 * Adding an env var: extend this schema, mirror it in `.env.example`,
 * and document its meaning in `docs/operations.md` if it changes runtime
 * behavior visible to operators.
 *
 * Validation runs at module load. Misconfiguration fails fast — by design.
 */
const EnvSchema = z.object({
  // Runtime --------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Database -------------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (e.g. postgresql://app:app@localhost:5432/app)'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env: Env = parsed.data;
