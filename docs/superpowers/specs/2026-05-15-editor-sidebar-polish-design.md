# Editor & Sidebar Polish

**Date:** 2026-05-15
**Status:** Approved — ready for implementation plan
**Area:** `apps/web` notes UI (command bar, editor, notes shell, global CSS)

## Problem

Five small-to-medium polish items on the notes UI, reported by the user:

1. The search bar shows **two** clear buttons — our themed `×` plus the
   browser's native `type="search"` cancel button, which clashes with the
   visual theme.
2. The Markdown editor draws a **focus frame** around the whole A4 surface
   when focused — it looks odd.
3. Editor **headings and body text use different fonts** (serif headings,
   sans body); they should be uniform.
4. There is no way to **collapse the sidebar** for a full-width writing mode.
5. There is no way to **copy a note's Markdown** to the clipboard.

(A sixth request — pasting/dropping images into the editor — is intentionally
**out of scope** for this spec. It needs an asset-storage architecture
decision and gets its own design cycle. See "Non-goals".)

## Goals

1. Only the themed `×` appears in the search bar.
2. The editor's editable surface shows no focus outline; focus affordance
   elsewhere (buttons, inputs, folder tree) is unchanged.
3. Editor content — headings, body, and the note title above the editor —
   all use one font.
4. The sidebar can be collapsed to give the editor full width, and the
   choice is remembered.
5. A note's content can be copied to the clipboard as Markdown.

## Non-goals

- **Image paste / drag-and-drop into the editor.** Deferred to a separate
  spec — it requires an asset store (DB table / filesystem volume / object
  storage), an upload API, and a serving path, plus interaction with the
  Yjs collab doc and the PDF export. The editor and toolbar already document
  uploads as out of scope; that stays true here.
- Changing the app-wide type system. The serif/sans split in the sidebar and
  app chrome stays; only the **editor content** is unified.
- Changing how the note `body` is stored or the collab/save pipeline.

## Decisions (resolved during brainstorming)

- **Editor font:** unify to **Inter** (`--font-body`, the existing body
  font). Smallest change — body text already uses it.
- **Markdown copy:** convert the editor's current HTML (`editor.getHTML()`)
  to Markdown with **`turndown`** (+ its GFM plugin for task lists). This is
  isolated — it does not add a Tiptap content extension, so it cannot
  disturb content parsing, the Collaboration extension, or the save path.
  The rejected alternative, the `tiptap-markdown` extension, changes how the
  `content` string is parsed and risks misreading existing plain-text bodies.

## Design

### 1. Hide the native search clear button

`CommandBar`'s input is `type="search"`; WebKit/Blink render a
`::-webkit-search-cancel-button`. Add a rule to
`apps/web/src/app/globals.css`:

```css
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
}
```

`type="search"` is kept (semantics + native Escape-to-clear). The themed `×`
button in `CommandBar` is unaffected. The app has exactly one search input,
so the rule's reach is correct.

### 2. Remove the editor focus outline

The global accessibility rule `:focus-visible { outline: 2px solid
var(--color-accent) }` also matches the ProseMirror `contenteditable` root
when the editor is focused — a 2 px accent ring around the entire A4 sheet.
Suppress it only on the editable surface, in `globals.css`:

```css
.ProseMirror:focus,
.ProseMirror:focus-visible {
  outline: none;
}
```

The global focus ring stays for every real control (buttons, inputs, links,
the folder tree). The editor still signals focus through the caret. The
existing `focus:outline-none` utility class on the editor element stays.

### 3. Unify the editor font to Inter

In `globals.css`, the rule `.prose-paper :where(h1, h2, h3, h4)` sets
`font-family: var(--font-display)`. Change it to `var(--font-body)`. Heading
size and weight are unchanged — only the family.

The note title rendered above the editor in `NotesShell.tsx`
(`<h1 className="font-display …">`) currently uses the serif display font.
Change it to the body font so the editor area reads as one document.

`.prose-paper` is also used by the search-result snippet and the editor
skeleton, neither of which renders headings, so the change is editor-scoped.
The sidebar and app chrome (which use `font-display` directly) are untouched.

### 4. Collapsible sidebar

`NotesShell` gains a `sidebarCollapsed` boolean:
- Initialised from `localStorage` (key `effi-notes:sidebar-collapsed`),
  so the choice survives reload and the per-route remount of `NotesShell`.
- Persisted back to `localStorage` on every toggle.

Layout: the shell grid switches between `grid-cols-[280px_1fr]` (expanded)
and a single editor column (collapsed) with a smooth width transition.

Controls:
- **Expanded:** a subtle collapse button in the sidebar header.
- **Collapsed:** a small expand button pinned at the top-left of the editor
  area, always reachable.
- **Keyboard:** `Cmd/Ctrl + \` toggles the sidebar. Backslash collides with
  no Tiptap editor command. The handler ignores the event when a modifier
  combo is already meaningful to the editor (it is not — `\` is free).

The collapse state is a UI preference, so it lives in `localStorage`, not the
URL (unlike the search filter).

### 5. Copy-as-Markdown button

A subtle icon button in the editor's **top bar, right side** — the existing
`flex items-center justify-between` header that already holds `PresenceBar`
(left) and `SaveIndicator` (right). The copy button sits at the far right,
after the save indicator.

On click:
1. Read `editor.getHTML()`.
2. Convert HTML → Markdown with `turndown`, configured with
   `turndown-plugin-gfm` so task lists, strikethrough, and tables survive.
3. Write the result via `navigator.clipboard.writeText(...)`.
4. Show brief "Copied" feedback (icon/label swap for ~2 s), then revert.

The conversion is a pure function (`htmlToMarkdown(html): string`) so it can
be unit-tested without the editor. The button is its own small component.
Nothing about the Tiptap extension list, the Collaboration document, or the
`putBody` save path changes.

## Components & files

| File | Change | Item |
|------|--------|------|
| `apps/web/src/app/globals.css` | hide native search `×`; suppress `.ProseMirror` focus outline; editor headings → `--font-body` | 1, 2, 3 |
| `apps/web/src/components/notes/NotesShell.tsx` | note title → body font; `sidebarCollapsed` state + localStorage + keyboard toggle; collapsed grid layout + expand button | 3, 4 |
| `apps/web/src/components/notes/Sidebar/index.tsx` | collapse button in the sidebar header (calls a passed-in handler) | 4 |
| `apps/web/src/lib/notes/markdown.ts` (new) | pure `htmlToMarkdown(html)` helper wrapping `turndown` + GFM plugin | 5 |
| `apps/web/src/components/notes/Editor/CopyMarkdownButton.tsx` (new) | subtle copy button with copied-feedback state | 5 |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | mount `CopyMarkdownButton` in the editor top bar | 5 |
| `apps/web/messages/en.json`, `de.json` | strings: collapse/expand sidebar, copy-markdown, "Copied" | 4, 5 |
| `package.json` (`apps/web`) | add `turndown` + `turndown-plugin-gfm` (+ `@types/turndown`); versions verified against `npm view` per repo rules | 5 |

## Testing

- **Items 1–3 (CSS only):** no Vitest unit test. Verified by `bun run build`
  + `bun run lint` and visual check. The plan notes the manual visual check.
- **Item 4:** the collapse state logic — `localStorage` read/write and the
  toggle — is exercised by a `NotesShell` interaction test or, if cleaner, a
  small extracted hook with its own test. `NotesShell` is not coverage-gated
  (E2E-covered), so this is best-effort behavioural coverage, not a gate.
- **Item 5:** `htmlToMarkdown` gets thorough unit tests (headings, lists,
  task lists, bold/italic, links, code). `CopyMarkdownButton` gets a
  component test with a mocked `navigator.clipboard` verifying the copied
  value and the feedback state. New files placed under coverage-gated paths
  (`lib/notes/**`) are added to the coverage `include` list and tested to
  the ≥90 % threshold.

## Risks & mitigations

- **`turndown` version compatibility:** pin a current version verified with
  `npm view turndown version` (repo rule: no invented versions). `turndown`
  is framework-agnostic and stable; risk is low.
- **Task-list HTML → Markdown fidelity:** Tiptap's `getHTML()` for
  `TaskItem` emits `<li data-checked><input type="checkbox">…`. The GFM
  plugin's task-list rule keys on the checkbox input; the unit tests assert
  `- [ ]` / `- [x]` output explicitly so any fidelity gap is caught.
- **Grid width transition jank:** transitioning `grid-template-columns` can
  stutter; if so, transition the sidebar element's own width instead. A
  cosmetic detail, resolved in implementation.
- **Keyboard shortcut focus:** the `Cmd/Ctrl+\` handler is a window-level
  listener; it calls `preventDefault()` only for that exact combo so it does
  not swallow other input.
