import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

const VALID = {
  NODE_ENV: 'test',
  APP_ENV: 'local',
  APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'warn',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app?schema=public',
  REDIS_URL: 'redis://localhost:6379/0',
  KEYCLOAK_ISSUER: 'http://localhost:8080/realms/app',
  KEYCLOAK_CLIENT_ID: 'app-web',
  KEYCLOAK_CLIENT_SECRET: 'test-secret',
  AUTH_SECRET: 'test-secret-must-be-32-bytes-or-longer',
  AUTH_URL: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('parses a complete valid env into a typed object', () => {
    const result = parseEnv(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DATABASE_URL).toBe(VALID.DATABASE_URL);
      expect(result.data.LOG_LEVEL).toBe('warn');
      expect(result.data.AUTH_TRUST_HOST).toBe(false);
      expect(result.data.DATABASE_POOL_MAX).toBe(10);
    }
  });

  it('coerces numeric env strings to numbers', () => {
    const result = parseEnv({ ...VALID, DATABASE_POOL_MAX: '25' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.DATABASE_POOL_MAX).toBe(25);
  });

  it('exposes defaults for optional values', () => {
    const result = parseEnv(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.WORKER_CONCURRENCY).toBe(4);
      expect(result.data.WORKER_HTTP_PORT).toBe(3100);
      expect(result.data.OTEL_SERVICE_NAME).toBe('app');
    }
  });

  it('rejects when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...without } = VALID;
    const result = parseEnv(without);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'DATABASE_URL')).toBe(true);
    }
  });

  it('rejects an AUTH_SECRET below 32 chars', () => {
    const result = parseEnv({ ...VALID, AUTH_SECRET: 'too-short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'AUTH_SECRET')).toBe(true);
    }
  });

  it('rejects a non-URL KEYCLOAK_ISSUER', () => {
    const result = parseEnv({ ...VALID, KEYCLOAK_ISSUER: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('transforms AUTH_TRUST_HOST=true into the boolean true', () => {
    const result = parseEnv({ ...VALID, AUTH_TRUST_HOST: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.AUTH_TRUST_HOST).toBe(true);
  });
});
