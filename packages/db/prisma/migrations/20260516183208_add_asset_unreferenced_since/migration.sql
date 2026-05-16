ALTER TABLE "Asset" ADD COLUMN "unreferencedSince" TIMESTAMP(3);
CREATE INDEX "Asset_unreferencedSince_idx" ON "Asset"("unreferencedSince");
