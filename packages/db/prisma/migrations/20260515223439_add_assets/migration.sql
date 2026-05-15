-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'PDF');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "contentType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "extractedText" TEXT NOT NULL DEFAULT '',
    "byteSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_noteId_idx" ON "Asset"("noteId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- effi-notes: generated tsvector over filename + caption + extractedText.
-- Keeps assets findable through the same search infrastructure as notes.
ALTER TABLE "Asset" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("filename", '') || ' ' ||
      coalesce("caption", '') || ' ' ||
      coalesce("extractedText", ''))
  ) STORED;

-- effi-notes: GIN index on searchVector for fast full-text lookup
CREATE INDEX "Asset_searchVector_gin" ON "Asset" USING GIN ("searchVector");
