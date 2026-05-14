import { prisma } from '@app/db';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import * as Y from 'yjs';

const log = createLogger({ component: 'yjs.persistence' });

/**
 * Persistence layer for the y-websocket session.
 *
 * - `loadDocFromDb(noteId)` returns a Y.Doc populated from `Note.yjsState`.
 *   If no state has been saved yet, the doc is empty — the client's Tiptap
 *   editor will pick up `Note.body` from the REST GET and seed the doc.
 * - `saveDocSnapshot(noteId, doc, actorId)` writes the encoded state to
 *   `Note.yjsState` and appends a row to `NoteHistory`. Called from the
 *   snapshot processor on a debounce/idle schedule.
 *
 * The markdown `Note.body` is updated by the client via PUT /api/notes/[id]/body
 * (Phase B). The worker does NOT render markdown — keeping ProseMirror out
 * of the worker keeps deps minimal and lets the editor schema evolve client-
 * side without a worker redeploy. ADR 0022 documents this split.
 */

export const loadDocFromDb = async (noteId: string): Promise<Y.Doc> => {
  const row = await prisma.note.findUnique({
    where: { id: noteId },
    select: { yjsState: true },
  });
  const doc = new Y.Doc();
  if (row?.yjsState) {
    try {
      Y.applyUpdate(doc, new Uint8Array(row.yjsState));
    } catch (err) {
      log.warn(
        { noteId, err: err instanceof Error ? err.message : 'unknown' },
        'failed to apply persisted yjs state — starting fresh doc',
      );
    }
  }
  return doc;
};

export const saveDocSnapshot = async (
  noteId: string,
  doc: Y.Doc,
  actorId: string | null,
): Promise<{ bytes: number }> => {
  return withSpan('yjs.persistence.save', { 'notes.id': noteId }, async () => {
    const state = Y.encodeStateAsUpdate(doc);
    const bytes = state.byteLength;

    // Ensure the note still exists; if not, skip (don't error — it may have
    // been deleted while the session was open).
    const note = await prisma.note.findUnique({ where: { id: noteId }, select: { id: true } });
    if (!note) {
      log.info({ noteId }, 'note disappeared during session — skipping snapshot');
      return { bytes: 0 };
    }

    await prisma.note.update({
      where: { id: noteId },
      data: {
        yjsState: Buffer.from(state),
        ...(actorId === null ? {} : { lastEditorId: actorId }),
      },
    });

    if (actorId !== null) {
      await prisma.noteHistory.create({
        data: {
          noteId,
          authorId: actorId,
          // body comes from client's PUT path; we keep the row marker only
          body: '',
          yjsState: Buffer.from(state),
        },
      });
    }

    log.info({ noteId, bytes, actorId }, 'yjs snapshot saved');
    return { bytes };
  });
};
