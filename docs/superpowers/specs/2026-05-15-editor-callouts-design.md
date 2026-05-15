# Editor Callouts

**Date:** 2026-05-15
**Status:** Approved — ready for implementation plan
**Area:** `apps/web` notes editor (Tiptap extension, toolbar, global CSS, Markdown export)

## Problem

The notes editor has no callout/admonition blocks. We want the five
GitHub-style callouts — Note, Tip, Important, Warning, Caution — inserted
from a toolbar dropdown and rendered like the approved screenshot (coloured
left border, tinted background, type icon, bold title, body content).

Their Markdown form is the GitHub/Obsidian syntax:

```
> [!NOTE] A Note
> With some content
```

## Goals

1. A `callout` block node in the editor with five types.
2. A toolbar entry that opens a dropdown of the five types; clicking one
   inserts that callout at the cursor.
3. Callouts render with a per-type colour, icon, and bold title.
4. The existing "Copy as Markdown" button exports callouts as
   `> [!TYPE] <title>` + `> `-prefixed body lines.

## Non-goals

- **Typing/paste parsing.** Typing `> [!NOTE] ` does NOT auto-convert to a
  callout (decided). Insertion is via the toolbar only. The editor's content
  pipeline is Yjs-first; Markdown is only an export concern here.
- Nesting callouts inside callouts, or custom per-callout colours.
- Changing how the note `body` is stored or the collab/save path.

## Design

### 1. `Callout` node extension

New file `apps/web/src/components/notes/Editor/CalloutExtension.ts` — a
Tiptap `Node`:

- `name: 'callout'`, `group: 'block'`, `content: 'block+'`, `defining: true`.
- One attribute `type`, default `'note'`, constrained to
  `note | tip | important | warning | caution`. The attribute is parsed
  from / rendered to `data-callout`.
- `parseHTML`: `div[data-callout]`.
- `renderHTML`: `['div', { 'data-callout': type, class: 'callout' }, 0]`.
- A command `setCallout(type)` that inserts a callout containing one empty
  paragraph and places the cursor inside it. The attribute value is
  validated against the five allowed types; an unknown type falls back to
  `note`.

Registered in `buildExtensions` in `MarkdownExtensions.ts`. The node does
not need a NodeView — the icon and title styling are pure CSS.

### 2. Styling (`globals.css`)

A `.callout` block:
- `position: relative`, rounded corners, left padding reserving room for the
  icon, a 3–4 px coloured left border, and a faint tinted background.
- Per-type colour selected by `[data-callout="note|tip|important|warning|caution"]`
  — blue, green, purple, yellow, orange respectively, matching the
  screenshot.
- The icon is a CSS `::before` per type: an inline SVG applied via
  `mask-image` so it takes the type colour, positioned beside the first line.
- `.callout > :first-child` is the title: bold, in the type's colour. The
  remaining children render as normal body content.

CSS lives alongside the existing editor styles in `globals.css`; the rules
target `.callout` so they only apply inside the editor surface.

### 3. Toolbar dropdown

New file `apps/web/src/components/notes/Editor/CalloutMenu.tsx` — a small
component: a single toolbar button that toggles a dropdown listing the five
types (each row: type icon + translated name). Clicking a row runs
`editor.chain().focus().setCallout(type).run()` and closes the dropdown. The
dropdown closes on outside-click and on Escape. It owns only its open/closed
state.

`EditorToolbar.tsx` gains a new `Group` containing the `CalloutMenu` (after
the link group, before the closing of the bar).

### 4. Markdown export (`markdown.ts`)

`htmlToMarkdown` gets a custom Turndown rule for `div[data-callout]`:
- Read the type from `data-callout`.
- Serialize the callout's inner content; treat the first line as the title,
  the rest as body.
- Emit `> [!<TYPE>] <title>` followed by `> <line>` for each body line
  (`<TYPE>` upper-cased: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`).

This rule sits next to the existing `tiptapTaskItem` rule. No change to the
copy button or the editor pipeline.

### 5. i18n

New strings in `apps/web/messages/en.json` and `de.json` under a
`notes.callouts` block: the toolbar button label, and the five type names
(Note/Tip/Important/Warning/Caution and their German equivalents). Both
files stay key-aligned.

## Files

| File | Change |
|------|--------|
| `apps/web/src/components/notes/Editor/CalloutExtension.ts` | **new** — the `callout` node + `setCallout` command |
| `apps/web/src/components/notes/Editor/CalloutMenu.tsx` | **new** — toolbar dropdown |
| `apps/web/src/components/notes/Editor/MarkdownExtensions.ts` | register `Callout` in `buildExtensions` |
| `apps/web/src/components/notes/Editor/EditorToolbar.tsx` | mount `CalloutMenu` in a new toolbar group |
| `apps/web/src/lib/notes/markdown.ts` | Turndown rule for `div[data-callout]` |
| `apps/web/src/app/globals.css` | `.callout` styling + per-type colour/icon |
| `apps/web/messages/en.json`, `de.json` | `notes.callouts` strings |
| `vitest.config.ts` | add `CalloutExtension.ts` + `CalloutMenu.tsx` to coverage `include` |

## Testing

The repo enforces a ≥90 % / ≥80 % coverage gate; tests precede implementation.

- **`CalloutExtension.ts`** (added to coverage `include`): unit-tested with a
  headless `@tiptap/core` `Editor` — `setCallout(type)` inserts a callout
  with the right `type` attribute; the type guard falls back to `note` for
  an invalid value; HTML round-trips through `renderHTML`/`parseHTML`.
- **`CalloutMenu.tsx`** (added to coverage `include`): component test —
  the button opens the dropdown, the five types render, clicking a type
  calls the editor command, Escape/outside-click closes it.
- **`markdown.ts`**: tests for the callout Turndown rule — each of the five
  types exports to `> [!TYPE] title` + `> ` body lines.
- **`EditorToolbar.test.tsx`**: a case asserting the callout toolbar button
  renders.

## Risks

- **Callout type in `getText()`:** `editor.getText()` (the `body` index)
  drops the `[!TYPE]` marker — callouts persist via the Yjs doc, like all
  editor content. This is the existing editor architecture and out of scope.
- **Icon fidelity:** the five icons are recreated as inline SVGs in the Lucide
  style; exact pixel-matching of the screenshot is not required, visual
  parity is.
- **Turndown rule + nested content:** the callout body can contain lists or
  other blocks; the export rule prefixes every produced line with `> ` so
  nested structure stays inside the blockquote. Tests cover a multi-line body.
