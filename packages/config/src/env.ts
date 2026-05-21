import { z } from 'zod';

/**
 * Single source of truth for environment variables.
 *
 * Adding an env var: extend this schema, mirror it in `.env.example`,
 * and document its meaning in `docs/operations.md` if it changes runtime
 * behavior visible to operators.
 *
 * Validation runs at module load. Misconfiguration fails fast — by design.
 * `parseEnv()` is exposed so unit tests can assert schema behaviour without
 * triggering the process-exit side effect.
 */
export const EnvSchema = z.object({
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

  // Auth (Keycloak via auth.js v5) ---------------------------------------
  KEYCLOAK_ISSUER: z.string().url('KEYCLOAK_ISSUER must be a full realm URL'),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 chars (use `openssl rand -base64 32`)'),
  AUTH_URL: z.string().url().default('http://localhost:3000'),
  AUTH_TRUST_HOST: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Observability (OpenTelemetry) ----------------------------------------
  // Empty endpoint → SDK still patches modules but exports nothing.
  // Customer can disable export entirely without removing the SDK.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),
  OTEL_SERVICE_NAME: z.string().default('app'),
  OTEL_RESOURCE_ATTRIBUTES: z.string().default(''),

  // Jobs (BullMQ + Redis) ------------------------------------------------
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (e.g. redis://localhost:6379/0)'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_HTTP_PORT: z.coerce.number().int().positive().default(3100),
  /** Internal URL the web app uses to proxy /admin/queues → worker's Bull Board. */
  BULL_BOARD_INTERNAL_URL: z.string().url().default('http://localhost:3100'),

  // Notes collab (y-websocket) -------------------------------------------
  /** Worker port for the y-websocket relay. Internal — not exposed to the host. */
  COLLAB_WS_PORT: z.coerce.number().int().positive().default(3101),
  /**
   * Public WS URL the browser uses to connect to the collab relay. In prod
   * this is `wss://${APP_HOSTNAME}` (Caddy routes /yjs/* to the worker);
   * in dev it is `ws://localhost:3101` because we map the worker port to
   * the host.
   */
  COLLAB_PUBLIC_URL: z.string().min(1).default('ws://localhost:3101'),
  /** Debounce window for the snapshot processor (ms). Higher = fewer DB writes. */
  NOTES_SNAPSHOT_DEBOUNCE_MS: z.coerce.number().int().positive().default(30_000),

  // Microsoft 365 (Outlook calendar linking — ADR 0031) ------------------
  // All three are OPTIONAL. The whole feature degrades to "not configured"
  // (Settings card shows a notice; the editor's `$$` trigger does nothing)
  // when any one is missing. Customers who don't want the integration just
  // leave them unset.
  MICROSOFT_TENANT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Pure parser — no side effects. Returns a Zod result so callers (tests,
 * non-process contexts) can inspect issues without aborting.
 */
export const parseEnv = (raw: Record<string, string | undefined>) => EnvSchema.safeParse(raw);

const parsed = parseEnv(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Throw, do not call process.exit — this module is reached from
  // Next.js Edge middleware where process.exit is unsupported. An
  // uncaught throw still terminates Node-runtime apps loud and fast.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env: Env = parsed.data;
