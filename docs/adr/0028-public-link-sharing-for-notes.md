# ADR 0028 — Public (account-less) link sharing for notes

**Status:** Accepted
**Date:** 2026-05-19

## Context

ADR 0026 made notes and folders private by default, reachable only by their owner
or through an explicit per-user `Share` grant. It listed **"public / link-based
('anyone with the link') sharing"** as an explicit non-goal.

That non-goal now blocks a real use case: sharing a note with someone who has no
account on this deployment — a client, an external reviewer, a colleague at another
company. Today the only option is to create a Keycloak account for them, which is
disproportionate for read-only access to a single note.

Two related gaps are addressed together:

1. **No internal copy-link.** There is no quick way to copy a note's or folder's
   in-app URL for pasting into other documents or chats.
2. **No account-less access.** There is no way to let an unauthenticated visitor
   read a note.

## Decision

### Internal copy-link (no authorisation change)

A **"Copy link"** action is added next to the existing rename / duplicate / share
controls on note rows, and next to share / rename / delete on folder rows. It
copies the resource's normal in-app URL (`/notes/<id>` for a note,
`/notes?q=/<folderPath>` for a folder) to the clipboard. This is purely a
convenience — the link still requires a session and an access grant to open. No
change to ADR 0026's authorisation model.

### Public links — amends ADR 0026's non-goal

ADR 0026's non-goal "public / link-based sharing" is **superseded for notes only**.
Folders remain private-by-grant; there is no public folder link.

**Explicit, opt-in.** A note has no public link unless one is generated from the
Share dialog. Generating it requires `canManageShares` on the note (owner or
EDIT-grantee) — the same bar as creating a per-user share.

**Separate `PublicLink` table.** Public links are *not* modelled as `Share` rows.
`Share.granteeId` is a required FK to `User` with unique constraints
`(noteId, granteeId)` / `(folderId, granteeId)` and an XOR `CHECK`. A public link
has no grantee user; overloading `Share` would force a nullable `granteeId`, a
relaxed unique index, and a wider XOR — weakening every existing share invariant.
A dedicated `PublicLink` table (one row per note, FK to `Note`, optional
`expiresAt`, `createdById`, `createdAt`) keeps `Share` intact.

**Opaque random token.** The token is 256 bits of `crypto.randomBytes`,
base64url-encoded, stored in `PublicLink.token` (unique index). The database row
*is* the authority — no HMAC or signing secret is involved. Lookup is a single
indexed query; revocation is a row delete.

**One link per note; regenerate replaces.** `PublicLink.noteId` is unique.
Regenerating mints a fresh token and discards the old one — any previously
distributed URL stops working immediately. Revoke is a hard delete (mirrors the
`Share` DELETE semantics).

**Lazy expiry.** A public link may carry an optional `expiresAt` (set via the same
TTL picker used for per-user shares). An expired link grants nothing
(`expiresAt IS NULL OR expiresAt > now()`), checked at resolve time. No sweep job —
consistent with ADR 0026.

**VIEW-only, always.** A public link never confers edit access. The viewer is a
read-only render; there is no public write path and no public collaboration token.

### Public viewer route

The viewer lives at **`/p/[token]`** — a fresh top-level route, deliberately
*outside* `/notes/` (whose layout redirects unauthenticated users to `/login`).
`/p/` is added to the middleware `PUBLIC_PREFIXES` so it is reachable without a
session. The route serves a single `notFound()` for a missing, expired, revoked,
or archived target — no oracle distinguishing those states. It is rate-limited by
IP (existing `rateLimit` helper), carries `X-Robots-Tag: noindex`, and is served
under a stricter Content-Security-Policy than the authenticated app.

### Full formatted rendering, web-side

The viewer renders the note's **full formatted content** — headings, lists, tables,
images, callouts — not just plain text. The rich document lives in `Note.yjsState`
(a Yjs CRDT); `Note.body` is only a plain-text mirror used for search and snippets.

Rendering decodes `yjsState` → ProseMirror JSON (`y-prosemirror`) → HTML
(`@tiptap/html`) using a **schema-only subset** of the editor's TipTap extensions,
shared with the editor so the two cannot drift. The schema *is* the sanitiser:
`generateHTML` can only emit the nodes/marks that subset defines (no `<script>`,
no event handlers, no raw HTML) and escapes every text node. The one residual
vector — a hostile `href` / `src` — is closed by protocol-checking link and asset
URLs on the structured JSON before rendering, so no DOM-based sanitiser is needed.
This honours ADR 0022, which keeps ProseMirror out of the *worker* — the
rendering happens in `apps/web`, which already depends on TipTap, and the worker is
untouched. If `yjsState` is absent (a note never opened in the collaborative
editor), the viewer falls back to the escaped plain-text `body`.

Images and PDF chips in a public note are `Asset` rows behind auth-gated routes; a
token-scoped public asset route (`/p/[token]/assets/[assetId]`) streams only assets
belonging to the publicly-linked note.

## Relationship to prior ADRs

- **ADR 0026** — its "public/link sharing" non-goal is amended for notes only.
  `access.ts` remains the single authorisation source for *authenticated* access;
  public-link resolution is a separate sibling module (`public-link.ts`) that does
  not return an `Access` level — it returns a read-only note projection or null.
- **ADR 0022** — preserved. ProseMirror rendering stays out of the worker; the
  public viewer renders web-side. No new worker code.
- **ADR 0020 / 0021** — the `/p/` route uses a stricter CSP than the 0020 baseline
  and is rate-limited via the 0021 in-app Redis limiter.

## Consequences

- A note can be read by anyone holding its public URL until the link expires or is
  revoked. This is the intended capability; it is opt-in, per-note, and visible/
  manageable in the Share dialog.
- The public viewer renders from the last persisted `yjsState` snapshot, which the
  worker writes on an idle/debounce schedule — a public view can lag an in-progress
  live edit by that interval. Accepted.
- Rendering decodes the CRDT and generates HTML per request. Cheap for a notes app
  and rate-limited; a render cache is the documented escape hatch if it matters.
- New dependency in `apps/web`: `@tiptap/html` (`y-prosemirror` was already
  present). The editor's custom extensions must expose a server-safe schema path
  (no browser-only import at module load) to be reused for rendering. A DOM-based
  sanitiser (`jsdom`) was deliberately avoided — it does not bundle cleanly under
  the Next/Bun build, and the constrained schema makes it unnecessary.
- Public folder sharing remains a non-goal. A note with a public link still obeys
  ADR 0026 for every *authenticated* access path; the public link is an additional,
  independent read path.

## References

- Spec / plan: `docs/superpowers/specs/2026-05-16-resource-sharing-design.md`,
  ADR 0026 — Explicit per-resource sharing model
- ADR 0022 — Yjs / y-websocket in the worker (ProseMirror-out-of-worker contract)
- ADR 0020 — CSP baseline; ADR 0021 — in-app Redis rate limiting
- ADR 0023 — Asset storage in Postgres
