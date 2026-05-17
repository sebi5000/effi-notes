# ADR 0027: lucide-react as the icon library

**Status:** Accepted
**Date:** 2026-05-17

## Context

The notes UI needs icons — the folder-icons feature lets a folder carry a
chosen glyph, and future UI will want icons too. The template had no icon
library and no convention for one. Picking one now, deliberately, avoids each
feature reaching for a different set.

## Decision

Adopt `lucide-react` as the icon library for `apps/web`.

- It is the icon set shadcn/ui (already in the template stack) is built
  around, so it is the path-of-least-surprise choice.
- MIT-licensed — no attribution or copyleft obligation for customer forks.
- Tree-shakeable: icons are named imports, so the bundle cost is proportional
  to the icons actually used, not the ~1500-icon catalogue.

Icons are referenced by a small curated allow-list per feature (see
`apps/web/src/lib/notes/folder-icons.ts` for folders), never by dynamic name
lookup, so the bundler can see every used icon statically.

## Alternatives considered

- **Heroicons** — fine, but not shadcn/ui's native set; two icon vocabularies
  in one app is avoidable churn.
- **Phosphor** — larger, heavier, and again not the shadcn default.
- **Hand-rolled SVGs** — full control, but every icon becomes maintenance and
  the set the folder picker needs (~24) is too many to hand-author well.

## Consequences

- One new runtime dependency in `apps/web`.
- Future icon needs use `lucide-react` too; a different library would need a
  follow-up ADR.
- Curated allow-lists (not dynamic `name → component`) keep tree-shaking
  effective — a convention contributors must follow.

## References

- Spec: `docs/superpowers/specs/2026-05-17-folder-icons-design.md`
- Plan: `docs/superpowers/plans/2026-05-17-folder-icons.md`
