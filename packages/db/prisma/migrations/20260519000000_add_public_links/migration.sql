-- CreateTable
CREATE TABLE "PublicLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicLink_token_key" ON "PublicLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PublicLink_noteId_key" ON "PublicLink"("noteId");

-- CreateIndex
CREATE INDEX "PublicLink_expiresAt_idx" ON "PublicLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
