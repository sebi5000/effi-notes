-- CreateEnum
CREATE TYPE "ShareAccess" AS ENUM ('VIEW', 'EDIT');

-- AlterTable: Folder.ownerId — add nullable, backfill, then enforce NOT NULL
ALTER TABLE "Folder" ADD COLUMN "ownerId" TEXT;

UPDATE "Folder" f SET "ownerId" = (
  SELECT n."authorId" FROM "Note" n
   WHERE n."folderId" = f."id"
   ORDER BY n."updatedAt" DESC
   LIMIT 1
);

UPDATE "Folder" SET "ownerId" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1
) WHERE "ownerId" IS NULL;

ALTER TABLE "Folder" ALTER COLUMN "ownerId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "noteId" TEXT,
    "folderId" TEXT,
    "granteeId" TEXT NOT NULL,
    "access" "ShareAccess" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_ownerId_idx" ON "Folder"("ownerId");
CREATE INDEX "Share_granteeId_idx" ON "Share"("granteeId");
CREATE INDEX "Share_noteId_idx" ON "Share"("noteId");
CREATE INDEX "Share_folderId_idx" ON "Share"("folderId");
CREATE INDEX "Share_expiresAt_idx" ON "Share"("expiresAt");
CREATE UNIQUE INDEX "Share_noteId_granteeId_key" ON "Share"("noteId", "granteeId");
CREATE UNIQUE INDEX "Share_folderId_granteeId_key" ON "Share"("folderId", "granteeId");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- XOR check: exactly one of noteId / folderId is set
ALTER TABLE "Share" ADD CONSTRAINT "Share_exactly_one_target" CHECK (("noteId" IS NOT NULL) <> ("folderId" IS NOT NULL));
