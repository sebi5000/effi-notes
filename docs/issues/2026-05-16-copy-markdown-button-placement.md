# Copy-Markdown button placement and styling

**Date:** 2026-05-16
**Status:** Draft — ready for review
**Area:** `apps/web` notes editor (`CopyMarkdownButton`, `NoteEditor`)

## Problem

The "Copy as Markdown" button currently lives in the editor's meta bar above
the A4 sheet, sandwiched between the `SaveIndicator` and the right-hand edge
of the header strip. Two issues with that placement:

1. It sits **outside** the editing surface, in the chrome row that carries
   presence and save state. Visually it does not feel like an editor action;
   it feels like metadata.
2. The icon is rendered as plain text (`⧉`) with a faint muted-foreground
   colour and no container. Compared to the floating formatting toolbar at
   the bottom of the editor — a rounded-full pill with paper-line border,
   translucent background, backdrop blur and a soft shadow — the copy
   affordance looks like a different design system.

The request from the user: move the button into the **editor's right upper
corner** (i.e. anchored to the writing surface itself, not the meta bar), and
restyle it to match the **menu bar within the editor** (the floating
`EditorToolbar`), kept **nearly invisible** by default so it does not pull
attention away from writing.

## Goal

1. The button is rendered inside the editor area, pinned to the top-right.
2. Its container styling matches the `EditorToolbar` pill (rounded-full,
   `border-paper-line/80`, `bg-background/95`, shadow, `backdrop-blur`) so
   the two affordances read as the same family.
3. The button is **low opacity** by default (≈ 0.25–0.35) and ramps to full
   opacity on hover and keyboard focus, so an inactive editor shows almost
   nothing in that corner.
4. No regression in keyboard accessibility — `aria-label`, `title`, focus
   ring on focus-visible, and the existing "Copied" feedback all survive.
5. No regression in the existing test suite
   (`CopyMarkdownButton.test.tsx`).

## Non-goals

- Changing the copy logic. `htmlToMarkdown(editor.getHTML())` and the
  clipboard write stay exactly as they are. This is a presentation-only
  change.
- Adding a second action next to the copy button (e.g. "Export PDF"). If
  more actions are needed later, that is a separate spec — the styling
  decisions below leave room to grow the pill into a multi-button toolbar
  without rework.
- Making the button sticky to the viewport while the user scrolls. Static
  absolute positioning in the editor's top-right corner is sufficient for
  v1; sticky behaviour is a follow-up if usage shows people miss it after
  scrolling.
- Touching the bottom `EditorToolbar` itself. Its position, contents, and
  styling are unchanged.

## Design

### Files in scope

```
apps/web/src/components/notes/Editor/
├── NoteEditor.tsx          # move button out of header, wrap editor in relative
└── CopyMarkdownButton.tsx  # restyle as floating pill, low opacity
```

Messages files (`apps/web/messages/{de,en}.json`) need no changes — the
`notes.editorActions.copyMarkdown` / `copied` keys keep their semantics.

### Change 1 — `NoteEditor.tsx`

Inside the `CollaborativeEditor` render, do two things:

1. **Remove** the `CopyMarkdownButton` from the right-hand cluster of the
   header bar. After the change the header bar contains only the
   `PresenceBar` (left) and the `SaveIndicator` (right). The intermediate
   wrapper `<div className="flex items-center gap-3">` that previously
   grouped the save indicator with the copy button can collapse.

2. **Wrap** `<EditorContent>` in a `relative` container that owns the
   `flex-1 overflow-x-auto pb-24` classes currently on `EditorContent`
   itself, and render `<CopyMarkdownButton editor={editor} />` as the first
   child of that wrapper:

   ```tsx
   <div className="relative flex-1 overflow-x-auto pb-24">
     <CopyMarkdownButton editor={editor} />
     <EditorContent editor={editor} />
   </div>
   ```

   The `relative` is the positioning context for the absolutely-positioned
   button. Moving the layout classes off `EditorContent` onto the wrapper is
   safe — they are layout concerns, not editor concerns.

### Change 2 — `CopyMarkdownButton.tsx`

Replace the current minimal `className` with a pill that mirrors the
`EditorToolbar` container styling, anchored absolutely to the top-right
corner of its parent and dimmed by default:

```
border-paper-line/80 bg-background/95
text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground
hover:bg-muted
absolute top-3 right-3 z-10
inline-flex h-8 min-w-[2rem] items-center justify-center
rounded-full border px-2 text-sm
shadow-sm backdrop-blur transition-all
opacity-30 hover:opacity-100 focus-visible:opacity-100
```

Rationale for the individual choices:

- `border` + `border-paper-line/80` + `bg-background/95` + `shadow-sm` +
  `backdrop-blur` are the exact tokens the `EditorToolbar` container uses.
  Same visual family.
- `rounded-full`, `h-8`, `min-w-[2rem]`, `px-2`, `text-sm` match a single
  button inside that toolbar. The size is consistent with the bottom
  toolbar's `Btn` component.
- `absolute top-3 right-3 z-10` anchors the button to the corner of the
  editor area. `z-10` keeps it above the editor surface but below modals.
  `top-3 right-3` mirrors the visual offset of the floating toolbar from
  its container edges.
- `opacity-30` is the "nearly invisible" baseline. `hover:opacity-100` and
  `focus-visible:opacity-100` bring it forward when the user interacts.
  `transition-all` smooths the ramp.
- `hover:bg-muted` matches the per-button hover in the `EditorToolbar`.

Add `onMouseDown={(e) => e.preventDefault()}` to the button (the bottom
toolbar buttons do this). It stops the click from stealing the editor's
text selection — relevant if the user has highlighted something and wants
to keep the highlight after copying.

Keep the inner render branches as-is: the `⧉` glyph when idle, the `✓
Copied` text after a successful copy. The "Copied" branch can stay as
`text-xs` so the pill does not bulge during the 2 s feedback window —
acceptable trade-off because the layout shift is contained inside the pill.

Update the component docstring to describe the new positioning contract:

> Positioning note: the button is `absolute top-3 right-3`, so the parent
> MUST establish a positioning context (e.g. `relative`). The wrapper around
> `<EditorContent>` in `NoteEditor` does this.

### Visual reference

ASCII sketch of the editor surface after the change. The pill in the
top-right is the new home of the copy button:

```
┌─────────────────────────── header bar ─────────────────────────────────┐
│ PresenceBar avatars                              SaveIndicator         │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│            ┌──────────────────────── A4 sheet ───────────┐ ┌─┐         │
│            │  Note title                                 │ │⧉│ ← copy │
│            │                                             │ └─┘  pill  │
│            │  Body…                                      │            │
│            │                                             │            │
│            └─────────────────────────────────────────────┘            │
│                                                                        │
│                          ┌── EditorToolbar ──┐                         │
│                          │ H1 H2 H3 │ B I S  │                         │
│                          └───────────────────┘                         │
└────────────────────────────────────────────────────────────────────────┘
```

The pill is drawn at full opacity in the sketch for clarity. In the running
UI it sits at 30 % opacity until hovered or focused.

### Edge cases

- **Editor still loading (`editor === null`).** The button's existing guard
  (`if (!editor) return;` inside `copy`) already covers this. The pill
  still renders and looks the same; clicks are no-ops. Acceptable — the
  loading window is sub-second and the button is dim.
- **A4 sheet on a narrow viewport** (`overflow-x-auto` kicks in). The
  button stays anchored to the wrapper's right edge, which is the
  viewport's right edge — so the button remains visible and reachable
  regardless of horizontal scroll position.
- **Horizontal scroll inside the wrapper.** Because the wrapper itself is
  the scroll container and the button is positioned against the wrapper
  (not the scroll content), the button does not drift horizontally as the
  user scrolls the sheet sideways. Confirmed by `position: absolute`
  semantics — absolute children attach to the nearest positioned ancestor,
  which is the wrapper's `padding box`, unaffected by `scrollLeft`.
- **Touch devices** (no hover). `opacity-30` means a tap target that is
  visible-but-faint. `focus-visible` raises opacity on keyboard navigation;
  taps trigger the `onClick` directly. Acceptable — the user has indicated
  "minimize distraction" is the priority, and accidental taps are harmless
  (clipboard write is idempotent).

## Risks

- **Visual regression in dark mode** if/when a dark theme is added. The
  `bg-background/95` and `border-paper-line/80` tokens are theme-aware, so
  the pill will inherit theme-correct surfaces. Manual check on first dark
  theme work; nothing to do here.
- **Z-index collision with the floating bottom toolbar.** Both use `z-10`,
  and they occupy non-overlapping regions (top-right vs. bottom-centre), so
  no conflict in practice. If the page ever introduces a modal anchored to
  the editor it should use `z-20` or above.
- **`prose-paper` typography rules inside the A4 sheet** do not reach the
  button — the button is a sibling of the ProseMirror root, not a child of
  it, so heading / list / paragraph CSS does not apply.

## Tests

`apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx` asserts
five behaviours: clipboard write, "Copied" feedback, null-editor guard,
clipboard-rejection guard, and 2 s feedback timeout. All five depend only on
the `aria-label`, the rendered "Copied" text, and the `setTimeout` call —
none touch the `className` or the layout. The test file does not need to
change.

A reviewer should additionally:

1. Open a note in the dev server, confirm the pill sits in the editor's
   top-right at low opacity, and brightens on hover and on `Tab` focus.
2. Confirm clicking the pill copies the note's Markdown to the clipboard
   and shows "Copied" for ≈ 2 s.
3. Confirm the bottom `EditorToolbar` is unchanged.
4. Confirm the header bar shows only `PresenceBar` (left) and
   `SaveIndicator` (right) — no copy button there.
5. Resize the viewport narrow enough to trigger horizontal scroll of the
   A4 sheet; confirm the pill stays anchored to the right edge of the
   editor area.

## Rollout

Single-file mental model:

1. Edit `CopyMarkdownButton.tsx` (className + docstring + `onMouseDown`).
2. Edit `NoteEditor.tsx` (move button, wrap `EditorContent`).
3. Run `bun run vitest run apps/web/src/components/notes/Editor/CopyMarkdownButton.test.tsx`.
4. Run `bun run dev` and walk through the visual checklist above.
5. Commit as `feat(editor): float copy-markdown button in top-right`.

No migration, no env changes, no schema impact.
