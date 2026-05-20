# ADR 0029 — Account-level theme preference

**Status:** Accepted
**Date:** 2026-05-20

## Context

The app has a single hardcoded "Warm Paper" look: a `@theme` block in
`apps/web/src/app/globals.css` defines the `--color-*` and `--font-*` tokens
that Tailwind 4 compiles into utilities (`bg-paper`, `text-foreground`,
`text-accent`, …). Users want to pick from multiple themes — including a dark
theme — and have their choice follow them across devices (i.e. it must not be
device-local only).

## Decision

**Three themes shipped:** `warm-paper` (the current look), `dark`, and a third
distinct from both (designer-picked at implementation time). The closed set of
theme ids is exported from `apps/web/src/lib/theme/themes.ts` and consumed by
the Zod schema, the layout, the API, and the settings page — single source of
truth, no drift.

**CSS — `[data-theme]` overrides.** The `@theme { --color-* }` block in
`globals.css` is kept; the tokens it defines are what generate the utilities.
Each theme is expressed as a CSS selector that overrides those same custom
properties:

```
:root, [data-theme="warm-paper"] { --color-background: …; … }
[data-theme="dark"]              { --color-background: …; … }
[data-theme="<third>"]           { --color-background: …; … }
```

`data-theme` is set on `<html>`; switching it re-themes the whole tree without
re-rendering React or rebuilding Tailwind. Every theme block defines **all** of
the 10 `--color-*` tokens so no theme falls back inconsistently. Dark-mode
adaptations of the `.bg-paper` paper-grain SVG and the per-type callout tints
live next to the theme blocks they belong to. The A4 sheet stays
paper-white in every theme — it maps 1:1 to a PDF export.

**Data — `User.theme` is the source of truth.** A `theme String @default("warm-paper")`
column on the `User` table (Prisma) holds the preference. The default keeps
existing users on the current look on upgrade. The valid set is enforced by
the Zod schema + `isThemeId()` guard at the application boundary, not by a
Postgres enum — same pattern as the existing `locale` column.

**Cookie cache for FOUC-free SSR.** Server Components cannot set cookies
during render, so the layout resolves the theme as: cookie → (if absent &
authed) `User.theme` from the DB → `DEFAULT_THEME`. The cookie is written by
the theme API (and by the first authenticated read), making subsequent SSRs a
single cookie read. The DB read is gated behind the cookie-absent path so the
common case adds no latency. Pattern parallels `apps/web/src/i18n/request.ts`
(`resolveLocale`: session → cookie → header → default).

**Theme is deliberately kept OUT of the JWT / session / `AppUser` /
`upsertUser`.** CLAUDE.md (auth section) requires an ADR before changing JWT
or `upsertUser` semantics; this ADR explicitly chooses NOT to extend them.
Reasons: (1) theme is application state, not identity — Keycloak does not
manage it; (2) putting it in the JWT would make the session stale across
theme changes until token refresh; (3) the cookie-and-DB approach gives
instant apply, cross-device sync, and no auth-wiring change. `upsertUser`'s
update/create blocks already omit `theme`, so re-login leaves the preference
intact — a regression test locks this in.

**UI surface.** A `UserMenu` dropdown (top-right; modeled on
`Editor/CalloutMenu.tsx`) links to a new `/settings` page where the user picks
a theme from a card grid that shows each theme's palette in a small preview.
Selection PUTs to the theme API; the page also mutates
`document.documentElement.dataset.theme` immediately for instant apply.

## Relationship to prior ADRs

- **CLAUDE.md auth section** — explicitly preserved: no change to the JWT
  callback, refresh logic, or `upsertUser` semantics. `AppUser` is unchanged.
- **ADR 0020 (CSP)** — unchanged. Setting `data-theme` on `<html>` and
  swapping CSS custom properties is not a CSP-relevant action.
- **i18n resolution (`i18n/request.ts`)** — the theme resolver mirrors its
  cookie-and-fallback shape; `resolveLocale` and `resolveTheme` are siblings.

## Consequences

- A new dependency on the cookie as a render-fast cache. It is a strict cache:
  the DB is always authoritative; the cookie self-heals from the DB on first
  authenticated request when missing.
- Schema migration is hand-written (`ALTER TABLE … ADD COLUMN`) and applied
  with `prisma migrate deploy`; the dev DB carries pre-existing tsvector
  drift that would otherwise cause `migrate dev` to offer a reset (forbidden
  by CLAUDE.md hard rule 3).
- Cross-tab sync is not provided. Changing the theme in one tab does not push
  to other open tabs; the next navigation in those tabs reads the cookie and
  picks up the change. A `useSyncExternalStore` + custom-event pattern
  (template: `use-sidebar-collapsed.ts`) is a future option if required.
- Existing colour usages (`bg-paper`, `text-foreground`, `text-accent`, …)
  do not need to change — they already resolve through the same `--color-*`
  tokens the themes override.
- Themes are picked at the `<html>` level, so every page (`/notes`,
  `/dashboard`, `/settings`, `/login`, `/p/[token]`) inherits the user's
  theme. The public viewer at `/p/[token]` resolves to the default theme for
  unauthenticated visitors, which is intentional — it has no account.

## References

- `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`
- `apps/web/src/i18n/request.ts` — locale-resolution pattern
- `packages/db/prisma/schema.prisma` — `User` model
- `packages/auth/src/config.ts` — `upsertUser`
- ADR 0028 — Public link sharing for notes (most recent prior ADR)
