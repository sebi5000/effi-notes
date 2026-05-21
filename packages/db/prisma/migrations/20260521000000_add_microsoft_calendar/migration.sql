-- Microsoft 365 / Outlook calendar linking (ADR 0031).
--
-- Two tables:
--   MicrosoftAccount   per-user 1:1 with User; holds the long-lived
--                      refresh token (access tokens are fetched on demand
--                      and never persisted)
--   AppointmentLink    per-note backlink to a Graph calendar event with a
--                      small non-attendee snapshot (subject + start/end +
--                      webLink) used for chip rendering and the search
--                      route's third query source

CREATE TABLE "MicrosoftAccount" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "oid" TEXT NOT NULL,
    "upn" TEXT,
    "refreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MicrosoftAccount_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "MicrosoftAccount"
    ADD CONSTRAINT "MicrosoftAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppointmentLink" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "webLink" TEXT,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentLink_noteId_eventId_key" ON "AppointmentLink"("noteId", "eventId");
CREATE INDEX "AppointmentLink_noteId_idx" ON "AppointmentLink"("noteId");
CREATE INDEX "AppointmentLink_subject_idx" ON "AppointmentLink"("subject");

ALTER TABLE "AppointmentLink"
    ADD CONSTRAINT "AppointmentLink_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentLink"
    ADD CONSTRAINT "AppointmentLink_linkedById_fkey"
    FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
