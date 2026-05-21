# ADR 0031 — Microsoft 365 / Outlook calendar linking

**Status:** Accepted
**Date:** 2026-05-21

## Context

Users want to link notes to specific appointments from their Microsoft 365
Outlook calendar so meeting context lives next to meeting notes: type `$$` in
the editor → search calendar → pick an event → an inline chip is inserted into
the note. The chip is also surfaced in the right-hand DocumentPanel and an
attendee popover; the global search bar finds notes by the linked
appointment's subject.

The integration introduces three architectural questions the project hasn't
faced before:

1. **A second identity provider on top of Keycloak.** ADR 0003 makes Keycloak
   the source of truth for identity, and CLAUDE.md's auth Hard Rules forbid
   changing the JWT callback / `upsertUser` semantics without an ADR. Adding
   M365 as a second auth.js provider would touch every one of those.
2. **Storing a long-lived secret per user.** CLAUDE.md Rule #4 says "Never
   store the Keycloak access token in the database." Microsoft's OAuth model
   issues an `access_token` (~1 h) and a `refresh_token` (90+ days) — to keep
   the integration alive across sessions we MUST persist the refresh token
   somewhere.
3. **Live vs. snapshotted attendee data on a shared note.** A note can have
   multiple collaborators via the Share model (ADR 0026). If user A links
   their calendar event to a shared note, what does user B see — and from
   whose Graph token?

## Decision

**M365 is a per-user *linked integration*, not a second login provider.**
- The user signs in to the app via Keycloak as always (unchanged JWT flow,
  unchanged `upsertUser`, unchanged session shape).
- In `/settings` there's a separate "Connect Microsoft 365" affordance that
  runs its own OAuth code-grant flow against `login.microsoftonline.com/.../oauth2/v2.0/authorize`
  with `response_type=code`, `scope=offline_access Calendars.Read`,
  and a state nonce signed via HMAC over `AUTH_SECRET` + the Keycloak user id.
- The callback exchanges the code for `{access_token, refresh_token, id_token}`,
  upserts a `MicrosoftAccount` row keyed by `User.id`, and redirects back to
  `/settings`. The browser never sees the access token.
- The auth.js JWT cookie is untouched. M365 is opt-in and orthogonal —
  customers who don't configure the M365 env vars get a "not configured"
  banner in Settings and no `$$` overlay; everything else works as before.

**The Microsoft refresh token IS stored in Postgres** — a documented exception
to the Keycloak Rule #4 because:
- Microsoft's only mechanism for long-running offline access *is* the
  refresh token; there is no equivalent of Keycloak's "always re-prompt"
  fallback the cookie session provides.
- The Keycloak access token rule exists because Keycloak tokens are
  redundant (the JWT cookie already proves the session) AND short-lived
  (they would rot in stale rows). The Microsoft refresh token is the
  opposite on both counts: it's the only artefact, and it's long-lived
  by design (Microsoft rotates it on use, which we persist).
- Access tokens are NOT persisted — `tokens.ts` refreshes them on demand,
  uses them within the request, and discards them.

**Storage shape (per-user, two tables):**

```prisma
model MicrosoftAccount {
  userId       String   @id
  user         User     @relation(...)
  tenantId     String           // from id_token tid claim
  oid          String           // Microsoft user object id
  upn          String?          // display ("alice@contoso.com")
  refreshToken String   @db.Text
  scopes       String           // granted scopes, space-separated
  connectedAt  DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model AppointmentLink {
  id          String   @id @default(cuid())
  noteId      String
  note        Note     @relation(...)
  eventId     String           // Microsoft Graph event id (canonical)
  subject     String           // SNAPSHOT for chip text + search
  startsAt    DateTime?
  endsAt      DateTime?
  webLink     String?          // outlook.office.com link, snapshotted
  linkedById  String           // user who linked it (their M365 was the source)
  linkedBy    User     @relation(...)
  linkedAt    DateTime @default(now())

  @@unique([noteId, eventId])
  @@index([noteId])
  @@index([subject])
}
```

`MicrosoftAccount` is 1:1 with `User` (one M365 connection per app account).
`AppointmentLink` is the per-note backlink with a small, non-attendee
snapshot. Subject is mirrored from the snapshot so the chip renders without
hitting Graph and so the search route can find notes by appointment name
without a privileged Graph call.

**Attendees are always live-fetched** through the *viewer's own* M365 token.
- The attendee popover (chip click and DocumentPanel row click) calls
  `GET /api/users/me/microsoft/appointments/{id}/attendees`, which proxies
  Graph using the **currently-authenticated viewer's** access token.
- If the viewer has no `MicrosoftAccount`, the route returns
  `412 microsoft not connected` and the popover renders a "Connect M365"
  CTA pointing to `/settings`. The chip itself still renders (subject is in
  our DB) so the document reads coherently for non-connected collaborators.
- We deliberately do NOT denormalise attendees into our DB:
  - Attendees change frequently; cached lists are usually wrong.
  - Attendee lists may contain people who are NOT collaborators on the
    note; persisting them would expand the privacy footprint beyond what
    the Share model intends.

**Scope is `offline_access Calendars.Read` only.** Read-only Outlook access
is sufficient for searching events, snapshotting metadata, and listing
attendees. Write-back into Outlook (e.g. pushing the note's URL into the
event description) is explicitly out of scope for v1 — adding it later is a
separate consent dialog and a separate ADR amendment.

**Body-save reconciliation** mirrors the existing asset pattern. The editor
sends `appointmentIds` alongside `assetIds` in the 5-second body save; the
body route deletes `AppointmentLink` rows whose `eventId` no longer appears
in the doc (when `appointmentIds` is omitted by non-editor callers the route
leaves the table alone — same gating as `assetIds`).

## Explicitly NOT decided / NOT shipped

- **Calendars.ReadWrite (write-back to Outlook).** A future ADR amendment.
- **Encrypted-at-rest for the refresh token.** Single-tenant Compose with
  TLS in transit + non-root containers + restricted Postgres user is the
  current security boundary. A customer wanting column-level encryption
  can wrap `MicrosoftAccount.refreshToken` reads/writes in a Prisma
  middleware; the schema doesn't change.
- **Sharing one M365 connection across users.** Each user must connect
  their own account; service-principal / "shared mailbox" flows would be
  a different OAuth grant (client_credentials) and a different table.
- **Auto-refresh of `AppointmentLink.subject` when Outlook changes.**
  Snapshots are intentionally point-in-time. A "Refresh snapshot" button
  on the chip is the documented follow-up if drift becomes a complaint.
- **Reverse search "all my linked appointments across all notes".**
  AppointmentsSection is per-note. A global "my linked calendar" page is
  a separate feature.
- **Email integration (Mail.Read).** Out of scope; this ADR is calendars
  only.

## Consequences

**Positive.**
- Keycloak remains the single identity source — no JWT callback churn,
  no double session-error surface.
- The feature is opt-in at three levels: customer (env vars), user
  (Settings connect), and per-note (only notes the user types `$$` in
  get linked). Customers who don't want it never pay any UI cost.
- Live-attendee fetch avoids the data-privacy expansion that denormalised
  attendee storage would cause; collaborators on a shared note see
  attendees only if they themselves have consented to the integration.

**Negative / risks.**
- One extra long-lived secret per user in Postgres. Mitigated by the
  read-only scope, refresh-token rotation persistence, and the
  follow-up option to wrap the column in app-level encryption without
  schema changes.
- Live attendee fetch costs a Graph round-trip every time the popover
  opens. Acceptable: popovers are user-initiated, attendee lists are
  typically <30 rows, p99 Graph latency is <500 ms.
- Snapshot drift (subject changed in Outlook after link time). The chip
  may show stale text; the popover always shows fresh attendees. The
  "Refresh snapshot" follow-up is recorded above.

## Verification

A focused integration test in `apps/web/src/lib/microsoft/tokens.test.ts`
asserts:
1. Refresh-token rotation persists when Microsoft returns a new one.
2. `getMicrosoftAccessToken(userId)` returns null when the row is missing.
3. Refresh failure (e.g. revoked consent) deletes the row and returns null
   so the next caller can prompt the user to reconnect.

End-to-end (manual, with M365 env vars configured):
- Connect → consent → Settings card shows "Connected as upn".
- Type `$$` in a note, pick an event → chip appears.
- Open the same note from a different account that has access via Share
  but no M365 → chip + subject render, attendee popover shows
  "Connect M365".
