import { prisma } from './index.ts';

/**
 * Append-only audit log helper. Intentionally NOT auto-wired into route
 * handlers, auth callbacks, or workers — every customer project decides
 * which actions are auditable for their compliance regime.
 *
 * Usage:
 *   await recordAudit({ action: 'user.role.changed', actorId: session.userId, subject: targetUserId, metadata: { from, to } });
 */
export type AuditEvent = {
  /** Dot-namespaced action identifier, e.g. `user.login`, `invoice.deleted`. */
  action: string;
  /** Acting user (null for system events like cron). */
  actorId?: string | null;
  /** ID of the entity affected (free-form). */
  subject?: string | null;
  /** Anything else worth keeping. Avoid PII unless you have a reason. */
  metadata?: Record<string, unknown> | null;
  /** Caller-supplied request context. */
  ipAddress?: string | null;
  userAgent?: string | null;
};

export const recordAudit = async (event: AuditEvent): Promise<void> => {
  await prisma.auditLog.create({
    data: {
      action: event.action,
      actorId: event.actorId ?? null,
      subject: event.subject ?? null,
      metadata: (event.metadata ?? null) as never,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
    },
  });
};
