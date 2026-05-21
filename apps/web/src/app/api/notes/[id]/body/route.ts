import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import { jsonError, jsonOk, requireSession } from '@/lib/api/responses.ts';
import { putNoteBodySchema } from '@/lib/api/schemas.ts';
import { canEdit, resolveNoteAccess } from '@/lib/notes/access.ts';

const log = createLogger({ component: 'api.notes.body' });

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/notes/[id]/body — direct markdown save outside the CRDT session.
 *
 * Used by the editor on graceful disconnect and by import/automation. When
 * the note is being edited via the y-websocket session (Phase C wires the
 * presence check), this endpoint rejects with 409 — the CRDT is the source
 * of truth while a session is active.
 *
 * Optimistic concurrency: the client sends `baseBodyVersion` from the last
 * GET / previous PUT. Mismatch → 409 with the current value so the client
 * can re-render and ask the user to merge. The body-specific counter (not
 * the note's global `updatedAt`) means title-only patches and worker Yjs
 * snapshots can run without bumping the token and causing false 409s
 * (QA review 2026-05-20, P1).
 */
export const PUT = async (req: Request, ctx: RouteContext): Promise<Response> => {
  const user = await requireSession();
  if (!user) return jsonError(401, 'unauthorised');
  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'invalid json');
  }
  const parsed = putNoteBodySchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'invalid body', parsed.error.issues);

  const { body, baseBodyVersion } = parsed.data;

  return withSpan(
    'notes.body.put',
    { 'notes.id': id, 'notes.body_bytes': body.length },
    async () => {
      const existing = await prisma.note.findUnique({
        where: { id },
        select: { id: true, bodyVersion: true },
      });
      if (!existing) return jsonError(404, 'not found');

      const access = await resolveNoteAccess(user.id, id);
      if (!canEdit(access)) return jsonError(403, 'forbidden');

      if (existing.bodyVersion !== baseBodyVersion) {
        log.warn(
          {
            noteId: id,
            userId: user.id,
            baseBodyVersion,
            actualBodyVersion: existing.bodyVersion,
          },
          'note body PUT conflict',
        );
        return jsonError(409, 'conflict', {
          currentBodyVersion: existing.bodyVersion,
        });
      }

      const updated = await prisma.note.update({
        where: { id },
        data: { body, lastEditorId: user.id, bodyVersion: { increment: 1 } },
        select: { id: true, updatedAt: true, bodyVersion: true },
      });

      // Asset cleanup reconcile (sub-project D): stamp/un-stamp this note's
      // assets against the ids the editor reports. Skipped when assetIds is
      // omitted (non-editor callers) so they never mark a note asset-less.
      if (parsed.data.assetIds !== undefined) {
        const assetIds = parsed.data.assetIds;
        await prisma.$transaction([
          prisma.asset.updateMany({
            where: { noteId: id, id: { in: assetIds }, unreferencedSince: { not: null } },
            data: { unreferencedSince: null },
          }),
          prisma.asset.updateMany({
            where: { noteId: id, id: { notIn: assetIds }, unreferencedSince: null },
            data: { unreferencedSince: new Date() },
          }),
        ]);
      }

      // Appointment backlink reconcile (ADR 0031). Unlike assets (which are
      // soft-stamped so customer projects can keep recovery windows), the
      // AppointmentLink row is a pure backlink — once the chip is gone from
      // the doc the link has no meaning. Hard-delete rows whose eventId is
      // not in the reported set. Skipped when `appointmentIds` is omitted
      // (non-editor callers) so they never wipe a note's links.
      if (parsed.data.appointmentIds !== undefined) {
        const eventIds = parsed.data.appointmentIds;
        await prisma.appointmentLink.deleteMany({
          where: { noteId: id, eventId: { notIn: eventIds } },
        });
      }

      return jsonOk({
        id: updated.id,
        updatedAt: updated.updatedAt.toISOString(),
        bodyVersion: updated.bodyVersion,
      });
    },
  );
};
