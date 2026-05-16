import { enqueueNotesSnapshot } from '@app/jobs';
import { createLogger } from '@app/observability/logger';
import * as Y from 'yjs';
import { loadDocFromDb } from './persistence.ts';
import { verifyToken } from './token.ts';

const log = createLogger({ component: 'yjs.server' });

/**
 * Minimal y-websocket-style relay running on Bun.serve.
 *
 * Wire protocol: binary messages framed as the y-websocket reference impl
 * does — first byte is the message type, remainder is the payload.
 *
 *   0x00  sync          (uses y-protocols sync — step 1 / step 2 / update)
 *   0x01  awareness     (presence + cursor; relayed verbatim to other peers)
 *
 * We implement just the relay surface needed for Tiptap + y-prosemirror
 * collaboration:
 *   - On sync step 1 from a peer: respond with our Y.Doc as a single update
 *     (step 2-equivalent) and a step 1 of our own state vector
 *   - On any update: apply to our in-memory doc and broadcast to other peers
 *   - On awareness: relay to other peers without touching it
 *
 * Snapshots are debounced: each accepted update enqueues a notes.snapshot
 * job with `jobId = snapshot:<noteId>` and `delay = SNAPSHOT_DEBOUNCE_MS`.
 * BullMQ collapses bursts so the DB writes stay manageable.
 */

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

const SNAPSHOT_DEBOUNCE_MS = Number.parseInt(process.env.NOTES_SNAPSHOT_DEBOUNCE_MS ?? '30000', 10);

type PerSocket = {
  noteId: string;
  userId: string;
  access: 'r' | 'w';
  socket: WsLike;
};

type WsLike = {
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
};

const rooms = new Map<string, Set<PerSocket>>();
const docs = new Map<string, Y.Doc>();

const u8 = (numbers: number[]): Uint8Array => new Uint8Array(numbers);

const readVarUint = (data: Uint8Array, offset: number): { value: number; next: number } => {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < data.length) {
    const byte = data[cursor] ?? 0;
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: cursor };
    shift += 7;
  }
  throw new Error('truncated varint');
};

const writeVarUint = (value: number): Uint8Array => {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v & 0x7f);
  return u8(out);
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
};

const encodeSyncStep1 = (sv: Uint8Array): Uint8Array =>
  concatBytes(u8([MSG_SYNC]), u8([SYNC_STEP_1]), writeVarUint(sv.byteLength), sv);

const encodeSyncStep2 = (update: Uint8Array): Uint8Array =>
  concatBytes(u8([MSG_SYNC]), u8([SYNC_STEP_2]), writeVarUint(update.byteLength), update);

const encodeUpdate = (update: Uint8Array): Uint8Array =>
  concatBytes(u8([MSG_SYNC]), u8([SYNC_UPDATE]), writeVarUint(update.byteLength), update);

/**
 * Parse a binary message. Returns the decoded structure or null if the
 * message is malformed. Used by handleMessage and the test suite.
 */
export const parseMessage = (
  data: Uint8Array,
):
  | { kind: 'sync-step-1'; sv: Uint8Array }
  | { kind: 'sync-step-2'; update: Uint8Array }
  | { kind: 'sync-update'; update: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | null => {
  if (data.length < 2) return null;
  const type = data[0];
  if (type === MSG_AWARENESS) {
    return { kind: 'awareness', payload: data.subarray(1) };
  }
  if (type !== MSG_SYNC) return null;
  const subType = data[1];
  const { value: len, next } = readVarUint(data, 2);
  const body = data.subarray(next, next + len);
  if (subType === SYNC_STEP_1) return { kind: 'sync-step-1', sv: body };
  if (subType === SYNC_STEP_2) return { kind: 'sync-step-2', update: body };
  if (subType === SYNC_UPDATE) return { kind: 'sync-update', update: body };
  return null;
};

const getOrLoadDoc = async (noteId: string): Promise<Y.Doc> => {
  const cached = docs.get(noteId);
  if (cached) return cached;
  const doc = await loadDocFromDb(noteId);
  docs.set(noteId, doc);
  return doc;
};

export const getDocForNote = (noteId: string): Y.Doc | undefined => docs.get(noteId);

export const broadcastToRoom = (
  noteId: string,
  sender: PerSocket | null,
  data: Uint8Array,
): void => {
  const room = rooms.get(noteId);
  if (!room) return;
  for (const peer of room) {
    if (peer === sender) continue;
    try {
      peer.socket.send(data);
    } catch (err) {
      log.warn(
        { noteId, err: err instanceof Error ? err.message : 'unknown' },
        'failed to broadcast — closing peer',
      );
      try {
        peer.socket.close(1011, 'broadcast failure');
      } catch {
        // ignore
      }
    }
  }
};

const scheduleSnapshot = async (noteId: string, userId: string): Promise<void> => {
  try {
    await enqueueNotesSnapshot({ noteId, actorId: userId }, { delay: SNAPSHOT_DEBOUNCE_MS });
  } catch (err) {
    log.warn(
      { noteId, err: err instanceof Error ? err.message : 'unknown' },
      'failed to enqueue snapshot',
    );
  }
};

export const handleMessage = async (conn: PerSocket, data: Uint8Array): Promise<void> => {
  const msg = parseMessage(data);
  if (msg === null) {
    log.warn({ noteId: conn.noteId }, 'dropping malformed message');
    return;
  }
  const doc = await getOrLoadDoc(conn.noteId);

  if (msg.kind === 'sync-step-1') {
    const update = Y.encodeStateAsUpdate(doc, msg.sv);
    conn.socket.send(encodeSyncStep2(update));
    conn.socket.send(encodeSyncStep1(Y.encodeStateVector(doc)));
    return;
  }
  if (msg.kind === 'sync-step-2' || msg.kind === 'sync-update') {
    if (conn.access === 'r') {
      log.warn(
        { noteId: conn.noteId, userId: conn.userId },
        'dropping document update from read-only connection',
      );
      return;
    }
    Y.applyUpdate(doc, msg.update, conn);
    broadcastToRoom(conn.noteId, conn, encodeUpdate(msg.update));
    await scheduleSnapshot(conn.noteId, conn.userId);
    return;
  }
  if (msg.kind === 'awareness') {
    // Relay only — we don't track awareness on the server.
    broadcastToRoom(conn.noteId, conn, data);
    return;
  }
};

export type AuthResult =
  | { ok: true; noteId: string; userId: string; access: 'r' | 'w' }
  | { ok: false; reason: string };

/**
 * Verifies an incoming WS URL against the shared AUTH_SECRET. Exported so
 * tests can validate it without spinning up a real socket.
 */
export const authenticateUpgrade = (input: {
  pathname: string;
  searchParams: URLSearchParams;
  secret: string;
  now?: () => number;
}): AuthResult => {
  const match = input.pathname.match(/^\/yjs\/([A-Za-z0-9_-]{1,64})$/);
  if (!match) return { ok: false, reason: 'bad-path' };
  const pathNoteId = match[1] ?? '';
  const token = input.searchParams.get('token') ?? '';
  if (token === '') return { ok: false, reason: 'missing-token' };

  const parsed = verifyToken(
    input.now === undefined
      ? { secret: input.secret, token }
      : { secret: input.secret, token, now: input.now },
  );
  if (!parsed) return { ok: false, reason: 'invalid-token' };
  if (parsed.noteId !== pathNoteId) return { ok: false, reason: 'note-id-mismatch' };
  return { ok: true, noteId: parsed.noteId, userId: parsed.userId, access: parsed.access };
};

/**
 * Register a new WebSocket connection. Adds it to the room, sends the
 * initial sync-step-1, and returns a `close` function the caller invokes
 * when the socket disconnects.
 */
export const onSocketOpen = async (conn: PerSocket): Promise<() => void> => {
  const room = rooms.get(conn.noteId) ?? new Set<PerSocket>();
  room.add(conn);
  rooms.set(conn.noteId, room);

  const doc = await getOrLoadDoc(conn.noteId);
  conn.socket.send(encodeSyncStep1(Y.encodeStateVector(doc)));

  log.info({ noteId: conn.noteId, userId: conn.userId, peers: room.size }, 'yjs socket opened');

  return () => {
    const r = rooms.get(conn.noteId);
    if (!r) return;
    r.delete(conn);
    if (r.size === 0) {
      rooms.delete(conn.noteId);
      // Final snapshot when the last writer leaves — best-effort, fire and
      // forget so the close handler doesn't hang.
      void scheduleSnapshot(conn.noteId, conn.userId);
    }
    log.info({ noteId: conn.noteId, userId: conn.userId, peers: r.size }, 'yjs socket closed');
  };
};

/** Test-only: clear the in-memory rooms + docs cache between test cases. */
export const _resetForTests = (): void => {
  rooms.clear();
  docs.clear();
};

// Re-exports for test convenience.
export { encodeSyncStep1, encodeSyncStep2, encodeUpdate };
