# 0023 — Asset storage in PostgreSQL

## Status

Accepted

## Context

The notes editor needs to embed binary files (images now; PDFs next). The
bytes must be stored, served, backed up, and — per product requirement —
the files must be discoverable through the existing full-text search.

## Decision

Store asset bytes in PostgreSQL: a new `Asset` table with a `bytea` `data`
column, alongside metadata and a generated `tsvector` `searchVector` over
`filename + caption + extractedText`.

## Consequences

- No new infrastructure: no object store, no shared filesystem volume.
- Assets are included automatically in the existing `pg_dump` backup.
- The searchable text of an asset is a column in the same database as the
  `tsvector` search infrastructure — the search join is trivial.
- Asset writes are transactional with note data.
- Trade-off: blobs grow the application database. With the 10 MB per-image
  cap and a single-tenant deployment this is acceptable. A customer with
  heavy asset volumes can later swap the storage backend behind the same
  `Asset` interface (the upload/serve routes are the only readers of `data`).
- Rejected: a filesystem volume — it would split bytes from search text,
  require extending the backup script, and complicate horizontal scaling.
