# ADR 0022 — Real-time collaboration via Yjs in the worker, gated by HMAC tokens

**Status:** Accepted
**Date:** 2026-05-14

## Context

effi-notes needs real-time collaborative markdown editing. Two consultants on the same note should see each other's cursors and have changes converge within ~1 s. The constraints from CLAUDE.md and ADR 0010 / 0019 frame the choice:

- Single-tenant Compose deployment; no managed cloud collaboration service
- No new public-facing service beyond Caddy
- Existing template stack: BullMQ + Redis already provisioned, Next.js on Bun, Postgres
- Tests must hit real Postgres (no mocks)
- The web app already runs auth.js v5 sessions

## Decision

Run the y-websocket relay **inside the existing worker container** on port 3101 (internal-only), and gate the WebSocket upgrade with a short-lived HMAC-signed token issued by the web app's `/api/collab/[noteId]` route. Persist the Y.Doc state to `Note.yjsState` via a debounced BullMQ snapshot job. Markdown body (`Note.body`) stays the canonical text representation, updated by the client via `PUT /api/notes/[id]/body`.

```
browser  ── GET /api/collab/<noteId> ──→  apps/web (auth.js session check)
                                          ↓ issues HMAC(noteId:userId:exp, AUTH_SECRET)
browser  ←─── { url, token, expiresAt } ──
browser  ── WSS /yjs/<noteId>?token=… ──→  Caddy ──→  worker:3101
                                                      ↓ verifies token, joins room
y.applyUpdate broadcasts within the room; in-memory Y.Doc per noteId
                                                      ↓ debounced enqueue
                                          BullMQ notes.snapshot → Note.yjsState
```

Token format: `${noteId}:${userId}:${exp}:${b64u-hmac-sha256}`. TTL 60 s. Verified by the worker against the shared `AUTH_SECRET`.

## Alternatives considered

- **Hocuspocus (managed by Tiptap)** — turnkey but adds an external dep, a new auth model, and an additional license / cost decision for customers. Our use case is small enough that the y-websocket reference + our token gate fits in ~300 lines.
- **Next.js WebSocket route** — Next 16's App Router exposes `Response.json` but no WS upgrade primitive. Bun's native WS server in a separate process is cleaner.
- **Separate `collab` service container** — clear boundary but doubles the Compose surface; CLAUDE.md prizes "small and sharp" so we co-locate with the worker (already a Bun process, already on the data network).
- **Direct WS from browser to worker without proxy** — would require exposing 3101 to the public internet. Caddy now proxies `/yjs/*` to keep one public hostname and to inherit TLS + headers.
- **Storing canonical markdown in `Note.body` vs deriving from Y.Doc on save** — kept `body` as canonical because (a) all consumers (search, PUT, history) want plain markdown, and (b) the worker stays free of ProseMirror.

## Consequences

**Positive**
- No new container; Compose stack unchanged in shape
- Reuses `AUTH_SECRET` (already validated by `@app/config/env`) for token signing — no new secret management
- Token TTL of 60 s means a leaked URL is replay-resistant
- BullMQ collapses snapshot bursts via `jobId: snapshot:<noteId>` so DB writes stay manageable even under heavy editing
- Token signing/verification, snapshot persistence, and WS protocol code are independently testable (Vitest unit tests already cover all three)

**Negative / risks**
- In-memory rooms: a worker restart drops live state. Mitigation: the snapshot is debounced to ~30 s, so worst case is 30 s of work lives only in the active clients' Y.Doc when the worker dies. Clients reconnect and the surviving doc state is broadcast back to the room.
- Single worker = single active session per note. Horizontal scaling of the worker requires sticky routing to the same instance per noteId (out of scope for v1; would need Redis-backed coordination).
- Snapshot debounce (default 30 s, env-tunable via `NOTES_SNAPSHOT_DEBOUNCE_MS`) trades DB load for window-of-loss. Customer admins can tune.

## References

- Yjs (`yjs`, 13.6.x) — CRDT runtime
- y-protocols — sync + awareness wire formats
- y-prosemirror — client-side Tiptap binding
- ADR 0010 — Bun runtime in production
- ADR 0019 — migrator as a separate Compose service
- CLAUDE.md — Jobs and Auth invariants
