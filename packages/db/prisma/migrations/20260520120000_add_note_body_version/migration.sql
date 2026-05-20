-- Add a content-specific concurrency counter for body saves so title-only
-- patches and worker Yjs snapshots don't invalidate an in-flight body save
-- (QA review 2026-05-20, P1).
ALTER TABLE "Note" ADD COLUMN "bodyVersion" INTEGER NOT NULL DEFAULT 0;
