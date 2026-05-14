import type { NotesSnapshotPayload } from '@app/jobs/queues';
import { createLogger } from '@app/observability/logger';
import { withSpan } from '@app/observability/tracing';
import type { Job } from 'bullmq';
import { saveDocSnapshot } from '../yjs/persistence.ts';
import { getDocForNote } from '../yjs/server.ts';

const log = createLogger({ component: 'processor.notes.snapshot' });

/**
 * Persists the in-memory Y.Doc for a note. Enqueued by the y-websocket
 * server's debounce timer (every N updates / X idle seconds). Idempotent —
 * if the doc has nothing new to save, the operation is a no-op (re-writes
 * the same bytes).
 */
export const processNotesSnapshot = async (
  job: Job<NotesSnapshotPayload>,
): Promise<{ bytes: number }> =>
  withSpan('notes.snapshot', { 'job.id': job.id ?? '', 'notes.id': job.data.noteId }, async () => {
    const { noteId, actorId } = job.data;
    const doc = getDocForNote(noteId);
    if (!doc) {
      // No live session — the doc is already at rest in the DB.
      log.info({ noteId }, 'snapshot requested for inactive doc — noop');
      return { bytes: 0 };
    }
    await job.log(`snapshot noteId=${noteId} actor=${actorId ?? 'system'}`);
    return saveDocSnapshot(noteId, doc, actorId);
  });
