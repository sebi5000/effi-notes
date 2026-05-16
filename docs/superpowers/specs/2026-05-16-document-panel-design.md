# Document Panel (Sub-project C)

**Date:** 2026-05-16
**Status:** Approved — ready for implementation plan
**Area:** `apps/web` notes editor

## Context

This is **sub-project C**, the final part of a three-part feature (A → B → C):
- **A — Asset storage + Images** (done): the `Asset` model, image upload, the
  resizable image node.
- **B — PDF insert** (done): the `pdfChip` editor node, the `pdf.extract`
  worker job, and the first-page preview serve route
  `GET /api/assets/[id]/preview`.
- **C — Document panel** (this spec): a toggleable right-side panel beside the
  editor — a clickable heading outline, and lists of the note's images, PDFs,
  and links.

C is a pure `apps/web` UI feature. It reads everything it shows from the live
Tiptap editor document — it adds **no schema change, no new API, no worker
change**. It consumes two things A and B already built: the asset-serve route
`GET /api/assets/[id]` (image thumbnails) and the PDF preview route
`GET /api/assets/[id]/preview` (PDF thumbnails).

## Problem

A long note is hard to navigate, and its embedded images, PDFs, and links are
not discoverable at a glance. Users want a panel that shows the note's heading
structure (and lets them jump to a heading), plus lists of the images, PDFs,
and links the note contains.

## Goals

1. A **toggleable** right-side panel beside the editor, its open/closed state
   remembered — the same behaviour as the existing left sidebar.
2. Four sections, **stacked and always expanded**: **Outline**, **Images**,
   **PDFs**, **Links**.
3. **Outline** — the note's headings, indented by level, clickable to jump to
   a heading, with **scroll-spy** (the heading currently in view is
   highlighted).
4. **Images / PDFs** — **thumbnail** lists; clicking an item scrolls the editor
   to that node.
5. **Links** — split into **internal** (note-to-note) and **external**;
   clicking follows the link.

## Decisions (resolved during brainstorming)

- **Placement: a persistent, toggleable third column.** A fixed-width panel to
  the right of the editor, shown by default, with a show/hide toggle. The
  open/closed state persists in `localStorage`, mirroring the left sidebar's
  `useSidebarCollapsed` behaviour.
- **Section layout: stacked, always expanded.** All four sections live in one
  scrollable panel; no collapsing, no tabs.
- **Link classification: note-to-note links are internal.** A link is
  *internal* only when its href resolves to a `/notes/<id>` path on this app's
  own origin. Every other link — including other app pages and all web URLs —
  is *external*.
- **Asset lists show thumbnails.** Image items show the image itself; PDF items
  show the rendered first-page preview from B's preview route. A PDF whose
  preview the worker has not rendered yet shows a placeholder icon until the
  image loads.
- **Outline has scroll-spy.** The heading whose section is currently in view is
  highlighted as the user scrolls.

## Non-goals

- Editing from the panel (renaming, deleting, reordering) — the panel is
  read-only navigation. Asset deletion is **sub-project D**.
- A new API or schema change — every list is derived from the editor document
  client-side.
- Outline drag-to-reorder, link editing, or asset management.
- Showing the panel on the notes *list* page — it is part of the note editor
  only.
- Mobile / responsive collapse behaviour beyond the manual toggle — the panel
  is a fixed column the user can hide; narrow-viewport layout polish is out of
  scope for v1.

## Design

### 1. Data source — derive from the live editor document

Every section is derived **client-side from the Tiptap `editor` instance** (the
ProseMirror document). A pure helper module `doc-outline.ts` walks the document
once and returns the four lists:

- **Headings** — every `heading` node: its `level` (1–6), text content, and
  ProseMirror position.
- **Images** — every `image` node: `src`, `caption`, position.
- **PDFs** — every `pdfChip` node: `assetId`, `src`, `filename`, position.
- **Links** — every distinct `link` mark: `href`, the marked text, position.

The panel re-derives the lists whenever the editor document changes
(subscribing to the editor's update event), **debounced** so a burst of
keystrokes does not re-walk the document on every character.

The only network requests the panel makes are for thumbnails: the existing
`GET /api/assets/[id]` (image bytes) and `GET /api/assets/[id]/preview`
(PDF first-page preview).

### 2. Layout, placement, and the toggle

The panel renders **inside the `CollaborativeEditor` component**
(`NoteEditor.tsx`), where the `editor` instance already exists. Lifting
`editor` / `provider` / `ydoc` up to `NotesShell` to make the panel a
top-level grid column would be a large refactor for no visible benefit, so
`CollaborativeEditor`'s layout becomes a **horizontal split**:

- the editor area (toolbar + content) — `flex-1`,
- the document panel — a fixed-width column on the right, shown only when open.

A **toggle button** in the editor's header bar (the row that already holds the
presence bar, save indicator, and copy-as-Markdown button) shows and hides the
panel. The open/closed state is held by a `useDocPanel` hook backed by
`localStorage` — the same pattern as `useSidebarCollapsed` — so it survives
note switches and page reloads. Default: open.

### 3. Outline section

- Lists the note's headings, each indented by its level so the hierarchy is
  visible.
- Clicking a heading **scrolls the editor to it** and places the cursor at the
  heading — using the stored ProseMirror position mapped to the editor's DOM.
- **Scroll-spy:** an `IntersectionObserver` watches the heading DOM elements
  inside the editor's scroll container; the outline highlights whichever
  heading's section is currently in view. The observer is re-synced when the
  heading set changes — including changes made by a remote collaborator — by
  re-running on each editor update.
- Empty state when the note has no headings.

### 4. Images section

- A thumbnail list of the note's `image` nodes. The thumbnail reuses the
  image's own `src` (`/api/assets/<id>`), so the browser serves it from cache.
- The label is the image's `caption`; when the caption is empty a generic
  fallback label is shown (the `image` node carries no filename — only `src`,
  `caption`, and `width`).
- Clicking an item scrolls the editor to that image node.
- Empty state when the note has no images.

### 5. PDFs section

- A thumbnail list of the note's `pdfChip` nodes. The thumbnail is the rendered
  first-page preview, `GET /api/assets/<id>/preview`.
- The label is the `pdfChip` node's `filename` attribute.
- A PDF uploaded moments earlier — whose `pdf.extract` worker job has not yet
  rendered the preview — returns `404` from the preview route; the thumbnail
  `<img>`'s error handler swaps in a placeholder PDF icon. Once the worker
  finishes, a later render of the panel loads the real thumbnail.
- Clicking an item scrolls the editor to that `pdfChip` node.
- Empty state when the note has no PDFs.

### 6. Links section

- Lists the note's `link` marks, split into two sub-lists: **Internal** and
  **External**.
- **Classification:** a link is *internal* when its href, resolved against the
  app's origin, is a path of the form `/notes/<id>`. Relative hrefs and
  absolute hrefs on the app's own origin are both resolved. Every other link is
  *external*.
- Each item shows the link's text and its destination — the note reference for
  internal links, the host for external links.
- **Click behaviour:** an internal link navigates to that note within the app
  (client-side route change); an external link opens in a new browser tab.
  This deliberately differs from the scroll-to-node behaviour of the other
  three sections — a links list is for *following* references, not for locating
  them in one's own text.
- Empty state when the note has no links.

### 7. Click-to-scroll mechanics

Each derived outline / image / PDF item carries the ProseMirror position of its
node. Clicking the item sets the editor selection to that position and scrolls
the corresponding DOM node into view, using the editor view's
position-to-DOM mapping.

### 8. Internationalisation

All panel text — the four section titles, the "Internal" / "External"
sub-headings, the per-section empty states, and the toggle button's label —
goes through `next-intl` under a new `notes.docPanel` namespace. Both `en.json`
and `de.json` gain the identical key tree.

## Files

| File | Change |
|------|--------|
| `apps/web/src/lib/notes/doc-outline.ts` | **new** — pure derivation of headings / images / PDFs / links from the editor document; internal/external link classification |
| `apps/web/src/lib/notes/use-doc-panel.ts` | **new** — `localStorage`-backed open/closed toggle hook |
| `apps/web/src/components/notes/Editor/DocumentPanel.tsx` | **new** — the panel shell rendering the four sections |
| `apps/web/src/components/notes/Editor/OutlineSection.tsx` | **new** — the heading outline + scroll-spy |
| `apps/web/src/components/notes/Editor/AssetSection.tsx` | **new** — the thumbnail list, shared by the Images and PDFs sections |
| `apps/web/src/components/notes/Editor/LinksSection.tsx` | **new** — the internal / external link lists |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | horizontal-split layout; render `DocumentPanel`; the header-bar toggle button |
| `apps/web/src/app/globals.css` | document-panel styling |
| `apps/web/messages/en.json`, `de.json` | the `notes.docPanel` strings |
| `vitest.config.ts` | coverage `include` additions for the new files |

## Testing

The repo enforces a ≥ 90 % / ≥ 80 % coverage gate.

- **`doc-outline.ts`** — unit tests with a headless Tiptap editor: a document
  with headings / images / `pdfChip` nodes / links yields the correct four
  lists with correct positions; internal vs external link classification
  (a `/notes/<id>` href is internal, a relative non-note path and an external
  URL are external).
- **`use-doc-panel.ts`** — a hook test: default open, toggling persists to and
  reloads from `localStorage`.
- **`OutlineSection`** — component test: renders the headings indented by
  level, a click fires the jump callback, the active heading is highlighted.
- **`AssetSection`** — component test: renders thumbnail items, a click fires
  the callback, the PDF placeholder swaps in on image error.
- **`LinksSection`** — component test: internal and external links land in the
  correct sub-list with the correct click behaviour.
- **`DocumentPanel`** — component test: all four sections render; section
  empty states show when a list is empty.
- New coverage-gated files are added to the `vitest.config.ts` `include` list
  and tested to threshold.

## Risks

- **Re-derivation cost.** Walking the document to rebuild the four lists is
  O(document size). Re-running it on every keystroke would be wasteful, so the
  derivation is debounced; for very large notes this is still acceptable
  because the walk is a simple linear traversal.
- **Scroll-spy under collaboration.** A remote collaborator can add or remove
  headings; the `IntersectionObserver` must be torn down and re-created when
  the heading set changes. The panel re-syncs the observer on each editor
  update.
- **PDF preview not yet rendered.** A just-uploaded PDF has no preview until
  the worker job completes; the panel shows a placeholder until then and never
  blocks on the request.
- **Image labels.** The `image` node carries no filename, only `src` and
  `caption`, so an uncaptioned image is labelled generically. Accepted; adding
  a filename attribute to the image node is out of scope for C.
