-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "previewImage" BYTEA;
ALTER TABLE "Asset" ADD COLUMN "previewContentType" TEXT;
ALTER TABLE "Asset" ADD COLUMN "pageCount" INTEGER;
