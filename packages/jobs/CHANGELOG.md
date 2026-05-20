# @app/jobs

## 0.1.0

### Minor Changes

- 395b3a5: feat(notes): vertical slice — Folder/Note/Tag schema with full-text + trigram search, REST API for notes/folders/tags/search, real-time collaboration via yjs+y-websocket in the worker (HMAC-token gated), Warm Paper UI with Tiptap editor, folder tree, tag cloud, debounced command-bar search, and presence/save indicators. New ADR 0022 documents the collab architecture. 199 unit + integration tests; integration tests hit a real Postgres per CLAUDE.md.

### Patch Changes

- Updated dependencies [395b3a5]
  - @app/config@0.1.0
