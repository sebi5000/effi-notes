-- AlterTable
ALTER TABLE "Note" ADD COLUMN "titleManuallySet" BOOLEAN NOT NULL DEFAULT false;

-- Existing notes keep their human-set titles; only notes created after this
-- feature auto-title from the first heading.
UPDATE "Note" SET "titleManuallySet" = true;
