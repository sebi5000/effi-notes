export { type Env, env } from './env.ts';

/**
 * Env-based feature flags. The template ships zero flags by default —
 * customer projects add named getters here when a flag becomes load-bearing.
 *
 * Pattern:
 *   FEATURE_AUDIT_LOG=true → flags.auditLog === true
 */
export const flags = {
  auditLog: process.env.FEATURE_AUDIT_LOG === 'true',
} as const;

export type Flags = typeof flags;
