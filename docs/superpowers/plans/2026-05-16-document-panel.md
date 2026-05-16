# Document Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable right-side panel to the note editor showing a clickable heading outline (with scroll-spy) and thumbnail lists of the note's images, PDFs, and links (internal vs external).

**Architecture:** A pure `apps/web` UI feature. Every list is derived client-side from the live Tiptap editor document — no schema change, no new API, no worker change. Presentational section components receive plain data + callbacks; a `DocumentPanel` container owns all editor wiring (derivation, scroll-spy, jump-to-node). The panel renders inside `CollaborativeEditor` where the `editor` instance lives.

**Tech Stack:** Next.js 16, React 19, TypeScript 6 strict, Tiptap 3.23.4, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-document-panel-design.md` — read it before starting.

**Branch:** Work happens on `feat/notes-doc-panel` (already created off `feat/notes-pdf`). Do not switch branches.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/web/src/lib/notes/use-doc-panel.ts` | **new** — `localStorage`-backed open/closed toggle hook |
| `apps/web/src/lib/notes/use-doc-panel.test.ts` | **new** |
| `apps/web/src/lib/notes/doc-outline.ts` | **new** — pure derivation of headings/images/PDFs/links from the editor doc; internal-link classification |
| `apps/web/src/lib/notes/doc-outline.test.ts` | **new** |
| `apps/web/src/components/notes/Editor/OutlineSection.tsx` | **new** — presentational heading-outline list |
| `apps/web/src/components/notes/Editor/OutlineSection.test.tsx` | **new** |
| `apps/web/src/components/notes/Editor/AssetSection.tsx` | **new** — presentational thumbnail list (Images + PDFs) |
| `apps/web/src/components/notes/Editor/AssetSection.test.tsx` | **new** |
| `apps/web/src/components/notes/Editor/LinksSection.tsx` | **new** — presentational internal/external link lists |
| `apps/web/src/components/notes/Editor/LinksSection.test.tsx` | **new** |
| `apps/web/src/components/notes/Editor/DocumentPanel.tsx` | **new** — container: derivation, scroll-spy, jump, composes the sections |
| `apps/web/src/components/notes/Editor/DocumentPanel.test.tsx` | **new** |
| `apps/web/src/components/notes/Editor/NoteEditor.tsx` | horizontal-split layout; render `DocumentPanel`; header-bar toggle button |
| `apps/web/src/app/globals.css` | document-panel styling |
| `apps/web/messages/en.json`, `de.json` | the `notes.docPanel` strings |
| `vitest.config.ts` | coverage `include` additions for the four new component files |

---

## Task 1: `useDocPanel` toggle hook

**Files:**
- Create: `apps/web/src/lib/notes/use-doc-panel.ts`
- Create: `apps/web/src/lib/notes/use-doc-panel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/use-doc-panel.test.ts`:

```ts
// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDocPanel } from './use-doc-panel.ts';

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

describe('useDocPanel', () => {
  it('defaults to open', () => {
    const { result } = renderHook(() => useDocPanel());
    expect(result.current[0]).toBe(true);
  });

  it('toggles closed and persists to localStorage', () => {
    const { result } = renderHook(() => useDocPanel());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem('effi-notes:doc-panel-open')).toBe('false');
  });

  it('reads a persisted closed state on mount', () => {
    window.localStorage.setItem('effi-notes:doc-panel-open', 'false');
    const { result } = renderHook(() => useDocPanel());
    expect(result.current[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/lib/notes/use-doc-panel.test.ts`
Expected: FAIL — `./use-doc-panel.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `apps/web/src/lib/notes/use-doc-panel.ts`. Model it on `apps/web/src/lib/notes/use-sidebar-collapsed.ts` (open it first — same `useSyncExternalStore` pattern). The doc panel defaults to **open**; the stored value is the open flag (`'true'` / `'false'`), absent → open.

```ts
import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'effi-notes:doc-panel-open';
/** Same-tab notification — the native `storage` event only fires cross-tab. */
const CHANGE_EVENT = 'effi-notes:doc-panel-change';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

/** Absent or `'true'` → open; only an explicit `'false'` closes the panel. */
const getSnapshot = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

/** The server has no localStorage — render open there. */
const getServerSnapshot = (): boolean => true;

/**
 * Document-panel open/closed state, persisted in localStorage so it survives
 * reloads and the per-note remount of the editor. `useSyncExternalStore`
 * keeps it SSR-safe. Returns `[open, toggle]`.
 */
export const useDocPanel = (): readonly [boolean, () => void] => {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable (private mode / quota) — skip persistence
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [open, toggle] as const;
};
```

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/web/src/lib/notes/use-doc-panel.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/use-doc-panel.ts apps/web/src/lib/notes/use-doc-panel.test.ts
git commit -m "feat(notes): useDocPanel toggle hook"
```

---

## Task 2: `doc-outline.ts` — derive panel data from the editor doc

**Files:**
- Create: `apps/web/src/lib/notes/doc-outline.ts`
- Create: `apps/web/src/lib/notes/doc-outline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/notes/doc-outline.test.ts`. It builds a headless Tiptap editor from a ProseMirror-JSON document (deterministic — no HTML parsing) and derives the lists:

```ts
import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { NoteImage } from '../../components/notes/Editor/ImageExtension.ts';
import { PdfChipNode } from '../../components/notes/Editor/PdfChipExtension.ts';
import { deriveDocItems, isInternalNoteLink } from './doc-outline.ts';

const ORIGIN = 'http://localhost:3000';

const makeDoc = () => {
  const editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Intro' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Details' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'see note',
              marks: [{ type: 'link', attrs: { href: '/notes/abc123' } }],
            },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'the web',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/page' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: '/api/assets/img1', caption: 'A diagram' } },
        {
          type: 'pdfChip',
          attrs: { assetId: 'pdf1', src: '/api/assets/pdf1', filename: 'report.pdf', byteSize: 2048 },
        },
      ],
    },
  });
  return editor.state.doc;
};

describe('isInternalNoteLink', () => {
  it('treats a /notes/<id> path on the app origin as internal', () => {
    expect(isInternalNoteLink('/notes/abc', ORIGIN)).toBe(true);
    expect(isInternalNoteLink(`${ORIGIN}/notes/abc`, ORIGIN)).toBe(true);
  });
  it('treats other app pages and external URLs as external', () => {
    expect(isInternalNoteLink('/dashboard', ORIGIN)).toBe(false);
    expect(isInternalNoteLink('https://example.com/notes/abc', ORIGIN)).toBe(false);
    expect(isInternalNoteLink('not a url', ORIGIN)).toBe(false);
  });
});

describe('deriveDocItems', () => {
  it('derives headings with level, text, and position', () => {
    const { headings } = deriveDocItems(makeDoc(), ORIGIN);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Intro'],
      [2, 'Details'],
    ]);
    expect(headings[0]?.pos).toBeTypeOf('number');
  });

  it('derives image items', () => {
    const { images } = deriveDocItems(makeDoc(), ORIGIN);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ kind: 'image', src: '/api/assets/img1', label: 'A diagram' });
  });

  it('derives PDF items with the preview URL', () => {
    const { pdfs } = deriveDocItems(makeDoc(), ORIGIN);
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0]).toMatchObject({
      kind: 'pdf',
      label: 'report.pdf',
      previewSrc: '/api/assets/pdf1/preview',
    });
  });

  it('derives links and classifies internal vs external', () => {
    const { links } = deriveDocItems(makeDoc(), ORIGIN);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ href: '/notes/abc123', text: 'see note', internal: true });
    expect(links[1]).toMatchObject({ href: 'https://example.com/page', internal: false });
  });
});
```

NOTE: confirm the import paths for `NoteImage` / `PdfChipNode` resolve from `lib/notes/` (they live in `components/notes/Editor/`). If a relative path is awkward, the `@/` alias (`@/components/notes/Editor/...`) also works in tests. `StarterKit.configure({ link: false })` is required — StarterKit bundles its own Link; disabling it avoids a duplicate-extension warning when the standalone `Link` is added.

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/lib/notes/doc-outline.test.ts`
Expected: FAIL — `./doc-outline.ts` does not exist.

- [ ] **Step 3: Implement `doc-outline.ts`**

Create `apps/web/src/lib/notes/doc-outline.ts`:

```ts
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** A heading in the note, for the outline. */
export type OutlineHeading = { level: number; text: string; pos: number };

/** An image or PDF asset embedded in the note. */
export type AssetItem = {
  kind: 'image' | 'pdf';
  /** The asset's own URL (image src / PDF download). */
  src: string;
  /** The thumbnail URL — the image itself, or the PDF's preview route. */
  previewSrc: string;
  /** Display label — caption for images, filename for PDFs. */
  label: string;
  pos: number;
};

/** A link mark in the note. */
export type DocLink = {
  href: string;
  text: string;
  pos: number;
  /** True when the href resolves to a /notes/<id> path on the app origin. */
  internal: boolean;
};

/** The four derived lists shown by the document panel. */
export type DocItems = {
  headings: OutlineHeading[];
  images: AssetItem[];
  pdfs: AssetItem[];
  links: DocLink[];
};

const NOTE_PATH = /^\/notes\/[^/]+\/?$/;

/**
 * True when `href` resolves, against the app origin, to a `/notes/<id>` path
 * on that same origin — i.e. a link to another note in this app.
 */
export const isInternalNoteLink = (href: string, origin: string): boolean => {
  try {
    const url = new URL(href, origin);
    return url.origin === origin && NOTE_PATH.test(url.pathname);
  } catch {
    return false;
  }
};

/**
 * Walk a ProseMirror document once and derive the four lists the document
 * panel shows. Pure — no editor instance, no DOM. `origin` classifies links.
 */
export const deriveDocItems = (doc: ProseMirrorNode, origin: string): DocItems => {
  const headings: OutlineHeading[] = [];
  const images: AssetItem[] = [];
  const pdfs: AssetItem[] = [];
  const links: DocLink[] = [];
  // Consecutive text nodes carrying the same link mark are one link.
  let openLink: DocLink | null = null;

  doc.descendants((node, pos) => {
    if (node.isText) {
      const mark = node.marks.find((m) => m.type.name === 'link');
      if (mark) {
        const href = String(mark.attrs.href ?? '');
        if (openLink && openLink.href === href) {
          openLink.text += node.text ?? '';
        } else {
          openLink = {
            href,
            text: node.text ?? '',
            pos,
            internal: isInternalNoteLink(href, origin),
          };
          links.push(openLink);
        }
      } else {
        openLink = null;
      }
      return true;
    }

    // Any non-text node ends a link run.
    openLink = null;

    if (node.type.name === 'heading') {
      headings.push({
        level: Number(node.attrs.level) || 1,
        text: node.textContent,
        pos,
      });
    } else if (node.type.name === 'image') {
      const src = String(node.attrs.src ?? '');
      images.push({
        kind: 'image',
        src,
        previewSrc: src,
        label: String(node.attrs.caption ?? ''),
        pos,
      });
    } else if (node.type.name === 'pdfChip') {
      const src = String(node.attrs.src ?? '');
      const assetId = String(node.attrs.assetId ?? '');
      pdfs.push({
        kind: 'pdf',
        src,
        previewSrc: assetId ? `/api/assets/${assetId}/preview` : '',
        label: String(node.attrs.filename ?? ''),
        pos,
      });
    }
    return true;
  });

  return { headings, images, pdfs, links };
};
```

NOTE: verify `@tiptap/pm/model` resolves for the `Node` type (Tiptap 3 ships the ProseMirror libraries under `@tiptap/pm/*`). If it does not, import the node type from `@tiptap/core` (it re-exports ProseMirror model types) or accept the doc typed via `Editor['state']['doc']`. Do not use a bare `any`.

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/web/src/lib/notes/doc-outline.test.ts`
Expected: PASS — all cases.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/notes/doc-outline.ts apps/web/src/lib/notes/doc-outline.test.ts
git commit -m "feat(notes): derive outline/images/pdfs/links from the editor doc"
```

---

## Task 3: `OutlineSection` — presentational heading outline

**Files:**
- Create: `apps/web/src/components/notes/Editor/OutlineSection.tsx`
- Create: `apps/web/src/components/notes/Editor/OutlineSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/Editor/OutlineSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutlineHeading } from '@/lib/notes/doc-outline.ts';
import { OutlineSection } from './OutlineSection.tsx';

afterEach(cleanup);

const messages = { notes: { docPanel: { outline: 'Outline', empty: { outline: 'No headings yet' } } } };
const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const headings: OutlineHeading[] = [
  { level: 1, text: 'Intro', pos: 0 },
  { level: 2, text: 'Details', pos: 10 },
];

describe('OutlineSection', () => {
  it('renders each heading', () => {
    render(wrap(<OutlineSection headings={headings} activeIndex={0} onSelect={() => {}} />));
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
  });

  it('shows the empty state when there are no headings', () => {
    render(wrap(<OutlineSection headings={[]} activeIndex={-1} onSelect={() => {}} />));
    expect(screen.getByText('No headings yet')).toBeTruthy();
  });

  it('calls onSelect with the heading position when clicked', () => {
    const onSelect = vi.fn();
    render(wrap(<OutlineSection headings={headings} activeIndex={0} onSelect={onSelect} />));
    fireEvent.click(screen.getByText('Details'));
    expect(onSelect).toHaveBeenCalledWith(10);
  });

  it('marks the active heading with aria-current', () => {
    render(wrap(<OutlineSection headings={headings} activeIndex={1} onSelect={() => {}} />));
    expect(screen.getByText('Details').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Intro').getAttribute('aria-current')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/components/notes/Editor/OutlineSection.test.tsx`
Expected: FAIL — `./OutlineSection.tsx` does not exist.

- [ ] **Step 3: Implement `OutlineSection.tsx`**

Create `apps/web/src/components/notes/Editor/OutlineSection.tsx` — purely presentational (no editor, no observer; the container owns those):

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { OutlineHeading } from '@/lib/notes/doc-outline.ts';

type Props = {
  headings: ReadonlyArray<OutlineHeading>;
  /** Index of the heading currently scrolled into view, or -1. */
  activeIndex: number;
  /** Called with the heading's ProseMirror position when a row is clicked. */
  onSelect: (pos: number) => void;
};

/**
 * The document panel's heading outline. Rows are indented by heading level;
 * the active heading (computed by the container's scroll-spy) is marked with
 * `aria-current`. Presentational only.
 */
export function OutlineSection({ headings, activeIndex, onSelect }: Props) {
  const t = useTranslations('notes.docPanel');

  return (
    <section className="doc-panel-section">
      <h3 className="doc-panel-heading">{t('outline')}</h3>
      {headings.length === 0 ? (
        <p className="doc-panel-empty">{t('empty.outline')}</p>
      ) : (
        <ul className="doc-panel-list">
          {headings.map((h, i) => (
            <li key={`${h.pos}-${h.text}`}>
              <button
                type="button"
                className="doc-panel-outline-row"
                style={{ paddingLeft: `${(h.level - 1) * 0.75 + 0.25}rem` }}
                aria-current={i === activeIndex ? 'true' : undefined}
                onClick={() => onSelect(h.pos)}
              >
                {h.text || t('empty.outline')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

NOTE: the test asserts `aria-current` is the string `'true'` on the active row and absent otherwise — `aria-current={cond ? 'true' : undefined}` produces exactly that.

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/web/src/components/notes/Editor/OutlineSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Editor/OutlineSection.tsx apps/web/src/components/notes/Editor/OutlineSection.test.tsx
git commit -m "feat(notes): document-panel outline section"
```

---

## Task 4: `AssetSection` — presentational thumbnail list

**Files:**
- Create: `apps/web/src/components/notes/Editor/AssetSection.tsx`
- Create: `apps/web/src/components/notes/Editor/AssetSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/Editor/AssetSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetItem } from '@/lib/notes/doc-outline.ts';
import { AssetSection } from './AssetSection.tsx';

afterEach(cleanup);

const messages = {
  notes: { docPanel: { images: 'Images', pdfs: 'PDFs', empty: { images: 'No images' } } },
};
const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const items: AssetItem[] = [
  { kind: 'image', src: '/api/assets/i1', previewSrc: '/api/assets/i1', label: 'Diagram', pos: 4 },
];

describe('AssetSection', () => {
  it('renders the title and each item', () => {
    render(
      wrap(
        <AssetSection title="Images" emptyText="No images" items={items} onSelect={() => {}} />,
      ),
    );
    expect(screen.getByText('Images')).toBeTruthy();
    expect(screen.getByText('Diagram')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/assets/i1');
  });

  it('shows the empty state', () => {
    render(
      wrap(<AssetSection title="Images" emptyText="No images" items={[]} onSelect={() => {}} />),
    );
    expect(screen.getByText('No images')).toBeTruthy();
  });

  it('calls onSelect with the node position when an item is clicked', () => {
    const onSelect = vi.fn();
    render(
      wrap(
        <AssetSection title="Images" emptyText="No images" items={items} onSelect={onSelect} />,
      ),
    );
    fireEvent.click(screen.getByText('Diagram'));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('falls back to a placeholder when the thumbnail fails to load', () => {
    const pdfItem: AssetItem[] = [
      { kind: 'pdf', src: '/api/assets/p1', previewSrc: '/api/assets/p1/preview', label: 'r.pdf', pos: 9 },
    ];
    render(
      wrap(<AssetSection title="PDFs" emptyText="No PDFs" items={pdfItem} onSelect={() => {}} />),
    );
    const img = screen.getByRole('img');
    fireEvent.error(img);
    // After an error the <img> is replaced by the placeholder.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('asset-thumb-placeholder')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/components/notes/Editor/AssetSection.test.tsx`
Expected: FAIL — `./AssetSection.tsx` does not exist.

- [ ] **Step 3: Implement `AssetSection.tsx`**

Create `apps/web/src/components/notes/Editor/AssetSection.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { AssetItem } from '@/lib/notes/doc-outline.ts';

type Props = {
  title: string;
  emptyText: string;
  items: ReadonlyArray<AssetItem>;
  onSelect: (pos: number) => void;
};

/** A single thumbnail row — its own component so each tracks its load error. */
function AssetRow({ item, onSelect }: { item: AssetItem; onSelect: (pos: number) => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <li>
      <button type="button" className="doc-panel-asset-row" onClick={() => onSelect(item.pos)}>
        {failed || item.previewSrc === '' ? (
          <span className="doc-panel-asset-thumb-fallback" data-testid="asset-thumb-placeholder" aria-hidden="true">
            {item.kind === 'pdf' ? 'PDF' : 'IMG'}
          </span>
        ) : (
          // biome-ignore lint/performance/noImgElement: panel thumbnail — next/image cannot size an arbitrary asset
          <img
            src={item.previewSrc}
            alt=""
            className="doc-panel-asset-thumb"
            onError={() => setFailed(true)}
          />
        )}
        <span className="doc-panel-asset-label">{item.label || item.src}</span>
      </button>
    </li>
  );
}

/**
 * A document-panel section listing image or PDF assets as thumbnail rows.
 * Shared by the Images and PDFs sections. Presentational only.
 */
export function AssetSection({ title, emptyText, items, onSelect }: Props) {
  return (
    <section className="doc-panel-section">
      <h3 className="doc-panel-heading">{title}</h3>
      {items.length === 0 ? (
        <p className="doc-panel-empty">{emptyText}</p>
      ) : (
        <ul className="doc-panel-list">
          {items.map((item) => (
            <AssetRow key={`${item.pos}-${item.src}`} item={item} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}
```

NOTE: the `biome-ignore` on the `<img>` mirrors the one already on `ResizableImage.tsx` (open it to copy the exact ignore-comment format the repo's Biome accepts). If lint still flags it, match whatever suppression `ResizableImage.tsx` uses.

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/web/src/components/notes/Editor/AssetSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Editor/AssetSection.tsx apps/web/src/components/notes/Editor/AssetSection.test.tsx
git commit -m "feat(notes): document-panel asset (image/PDF) section"
```

---

## Task 5: `LinksSection` — internal / external link lists

**Files:**
- Create: `apps/web/src/components/notes/Editor/LinksSection.tsx`
- Create: `apps/web/src/components/notes/Editor/LinksSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/Editor/LinksSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocLink } from '@/lib/notes/doc-outline.ts';
import { LinksSection } from './LinksSection.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    docPanel: {
      links: 'Links',
      internal: 'Internal',
      external: 'External',
      empty: { links: 'No links' },
    },
  },
};
const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const links: DocLink[] = [
  { href: '/notes/abc', text: 'see note', pos: 2, internal: true },
  { href: 'https://example.com/p', text: 'the web', pos: 8, internal: false },
];

describe('LinksSection', () => {
  it('shows the empty state when there are no links', () => {
    render(wrap(<LinksSection links={[]} origin="http://localhost:3000" />));
    expect(screen.getByText('No links')).toBeTruthy();
  });

  it('puts an internal note link under Internal as an in-app link', () => {
    render(wrap(<LinksSection links={links} origin="http://localhost:3000" />));
    const internal = screen.getByText('see note').closest('a');
    expect(internal?.getAttribute('href')).toBe('/notes/abc');
    expect(internal?.getAttribute('target')).toBeNull();
  });

  it('puts an external link under External, opening in a new tab', () => {
    render(wrap(<LinksSection links={links} origin="http://localhost:3000" />));
    const external = screen.getByText('the web').closest('a');
    expect(external?.getAttribute('href')).toBe('https://example.com/p');
    expect(external?.getAttribute('target')).toBe('_blank');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/components/notes/Editor/LinksSection.test.tsx`
Expected: FAIL — `./LinksSection.tsx` does not exist.

- [ ] **Step 3: Implement `LinksSection.tsx`**

Create `apps/web/src/components/notes/Editor/LinksSection.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { DocLink } from '@/lib/notes/doc-outline.ts';

type Props = {
  links: ReadonlyArray<DocLink>;
  /** App origin, used to resolve an internal link's in-app path. */
  origin: string;
};

/** The in-app pathname an internal note link points at (e.g. `/notes/abc`). */
const notePath = (href: string, origin: string): string => {
  try {
    return new URL(href, origin).pathname;
  } catch {
    return href;
  }
};

/**
 * The document panel's Links section: the note's links split into Internal
 * (note-to-note, client-side `next/link`) and External (opened in a new tab).
 */
export function LinksSection({ links, origin }: Props) {
  const t = useTranslations('notes.docPanel');
  const internal = links.filter((l) => l.internal);
  const external = links.filter((l) => !l.internal);

  return (
    <section className="doc-panel-section">
      <h3 className="doc-panel-heading">{t('links')}</h3>
      {links.length === 0 ? (
        <p className="doc-panel-empty">{t('empty.links')}</p>
      ) : (
        <>
          {internal.length > 0 ? (
            <>
              <h4 className="doc-panel-subheading">{t('internal')}</h4>
              <ul className="doc-panel-list">
                {internal.map((l) => (
                  <li key={`${l.pos}-${l.href}`}>
                    <Link className="doc-panel-link-row" href={notePath(l.href, origin)}>
                      {l.text || l.href}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {external.length > 0 ? (
            <>
              <h4 className="doc-panel-subheading">{t('external')}</h4>
              <ul className="doc-panel-list">
                {external.map((l) => (
                  <li key={`${l.pos}-${l.href}`}>
                    <a
                      className="doc-panel-link-row"
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {l.text || l.href}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
```

NOTE: `next.config.ts` has `typedRoutes` enabled. `<Link href={notePath(...)}>` passes a dynamic `string`; if typed routes rejects it at typecheck, cast the prop to the `Route` type (`import type { Route } from 'next'`) — `href={notePath(...) as Route}` — rather than disabling the check or using `any`. Confirm what the installed Next types require.

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/web/src/components/notes/Editor/LinksSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Editor/LinksSection.tsx apps/web/src/components/notes/Editor/LinksSection.test.tsx
git commit -m "feat(notes): document-panel links section (internal/external)"
```

---

## Task 6: `DocumentPanel` — container (derivation, scroll-spy, jump)

**Files:**
- Create: `apps/web/src/components/notes/Editor/DocumentPanel.tsx`
- Create: `apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`. It builds a real headless editor (the same way `doc-outline.test.ts` does) so the panel can derive from a genuine document:

```tsx
// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteImage } from './ImageExtension.ts';
import { PdfChipNode } from './PdfChipExtension.ts';
import { DocumentPanel } from './DocumentPanel.tsx';

afterEach(cleanup);

// jsdom has no IntersectionObserver — stub it.
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const messages = {
  notes: {
    docPanel: {
      title: 'Document',
      outline: 'Outline',
      images: 'Images',
      pdfs: 'PDFs',
      links: 'Links',
      internal: 'Internal',
      external: 'External',
      empty: { outline: 'No headings yet', images: 'No images', pdfs: 'No PDFs', links: 'No links' },
    },
  },
};

const makeEditor = () =>
  new Editor({
    extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
      ],
    },
  });

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('DocumentPanel', () => {
  it('renders all four section titles', () => {
    render(wrap(<DocumentPanel editor={makeEditor()} />));
    expect(screen.getByText('Outline')).toBeTruthy();
    expect(screen.getByText('Images')).toBeTruthy();
    expect(screen.getByText('PDFs')).toBeTruthy();
    expect(screen.getByText('Links')).toBeTruthy();
  });

  it('derives the outline from the editor document', () => {
    render(wrap(<DocumentPanel editor={makeEditor()} />));
    expect(screen.getByText('Section A')).toBeTruthy();
  });

  it('shows empty states for sections with no items', () => {
    render(wrap(<DocumentPanel editor={makeEditor()} />));
    expect(screen.getByText('No images')).toBeTruthy();
    expect(screen.getByText('No PDFs')).toBeTruthy();
    expect(screen.getByText('No links')).toBeTruthy();
  });

  it('renders nothing-but-empty gracefully when editor is null', () => {
    const { container } = render(wrap(<DocumentPanel editor={null} />));
    expect(container.querySelector('.doc-panel')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run vitest apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`
Expected: FAIL — `./DocumentPanel.tsx` does not exist.

- [ ] **Step 3: Implement `DocumentPanel.tsx`**

Create `apps/web/src/components/notes/Editor/DocumentPanel.tsx`. It owns: deriving `DocItems` from the editor (re-derived, debounced, on editor updates), the scroll-spy `IntersectionObserver` → active heading index, and the jump-to-node handler.

```tsx
'use client';

import type { Editor } from '@tiptap/core';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type DocItems, deriveDocItems } from '@/lib/notes/doc-outline.ts';
import { AssetSection } from './AssetSection.tsx';
import { LinksSection } from './LinksSection.tsx';
import { OutlineSection } from './OutlineSection.tsx';

const EMPTY: DocItems = { headings: [], images: [], pdfs: [], links: [] };

type Props = { editor: Editor | null };

/**
 * The document panel container. Derives the heading/image/PDF/link lists from
 * the live editor document (re-derived, debounced, on every editor update),
 * runs the outline scroll-spy, and handles click-to-jump. The section
 * components below it are purely presentational.
 */
export function DocumentPanel({ editor }: Props) {
  const t = useTranslations('notes.docPanel');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const [items, setItems] = useState<DocItems>(EMPTY);
  const [activeHeading, setActiveHeading] = useState(-1);

  // Re-derive the lists whenever the document changes, debounced so a burst of
  // keystrokes does not re-walk the document on every character.
  useEffect(() => {
    if (!editor) {
      setItems(EMPTY);
      return;
    }
    const recompute = () => setItems(deriveDocItems(editor.state.doc, origin));
    recompute();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(recompute, 300);
    };
    editor.on('update', onUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off('update', onUpdate);
    };
  }, [editor, origin]);

  // Scroll-spy: highlight the heading whose section is in the top of the
  // viewport. Re-observes when the heading set changes.
  useEffect(() => {
    if (!editor || items.headings.length === 0) {
      setActiveHeading(-1);
      return;
    }
    const els = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
    );
    if (els.length === 0) return;
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = els.indexOf(entry.target as HTMLElement);
          if (idx < 0) continue;
          if (entry.isIntersecting) visible.add(idx);
          else visible.delete(idx);
        }
        if (visible.size > 0) setActiveHeading(Math.min(...visible));
      },
      { rootMargin: '0px 0px -75% 0px' },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [editor, items.headings]);

  const handleSelect = useCallback(
    (pos: number) => {
      if (!editor) return;
      const node = editor.state.doc.nodeAt(pos);
      const chain = editor.chain().focus();
      if (node?.isAtom) chain.setNodeSelection(pos);
      else chain.setTextSelection(pos);
      chain.scrollIntoView().run();
    },
    [editor],
  );

  const sectionTitles = useMemo(
    () => ({ images: t('images'), pdfs: t('pdfs') }),
    [t],
  );

  return (
    <aside className="doc-panel" aria-label={t('title')}>
      <OutlineSection
        headings={items.headings}
        activeIndex={activeHeading}
        onSelect={handleSelect}
      />
      <AssetSection
        title={sectionTitles.images}
        emptyText={t('empty.images')}
        items={items.images}
        onSelect={handleSelect}
      />
      <AssetSection
        title={sectionTitles.pdfs}
        emptyText={t('empty.pdfs')}
        items={items.pdfs}
        onSelect={handleSelect}
      />
      <LinksSection links={items.links} origin={origin} />
    </aside>
  );
}
```

NOTE: confirm the editor update API against Tiptap 3.23.4 — `editor.on('update', fn)` / `editor.off('update', fn)` is the documented event API. `editor.state.doc.nodeAt(pos)` returns the node at a position; `setNodeSelection` / `setTextSelection` / `scrollIntoView` are standard chain commands. If `nodeAt` returns the wrong granularity for the stored positions, the derivation in Task 2 records `pos` from `doc.descendants` (the position *before* the node) — `nodeAt(pos)` at that position returns that node; adjust only if a test proves otherwise.

- [ ] **Step 4: Run the test**

Run: `bun run vitest apps/web/src/components/notes/Editor/DocumentPanel.test.tsx`
Expected: PASS — all four cases.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Editor/DocumentPanel.tsx apps/web/src/components/notes/Editor/DocumentPanel.test.tsx
git commit -m "feat(notes): DocumentPanel container — derivation, scroll-spy, jump"
```

---

## Task 7: Wire the panel into the editor + i18n + styling

**Files:**
- Modify: `apps/web/src/components/notes/Editor/NoteEditor.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the i18n strings**

In `apps/web/messages/en.json`, inside the `notes` object, immediately after the `editorUpload` block, add:

```json
    "docPanel": {
      "title": "Document",
      "show": "Show document panel",
      "hide": "Hide document panel",
      "outline": "Outline",
      "images": "Images",
      "pdfs": "PDFs",
      "links": "Links",
      "internal": "Internal",
      "external": "External",
      "empty": {
        "outline": "No headings yet",
        "images": "No images",
        "pdfs": "No PDFs",
        "links": "No links"
      }
    },
```

In `apps/web/messages/de.json`, in the same place:

```json
    "docPanel": {
      "title": "Dokument",
      "show": "Dokumentbereich einblenden",
      "hide": "Dokumentbereich ausblenden",
      "outline": "Gliederung",
      "images": "Bilder",
      "pdfs": "PDFs",
      "links": "Links",
      "internal": "Intern",
      "external": "Extern",
      "empty": {
        "outline": "Noch keine Überschriften",
        "images": "Keine Bilder",
        "pdfs": "Keine PDFs",
        "links": "Keine Links"
      }
    },
```

Both files must end up with the identical key tree. Keep the JSON valid (commas, nesting).

- [ ] **Step 2: Wire `DocumentPanel` into `CollaborativeEditor`**

Edit `apps/web/src/components/notes/Editor/NoteEditor.tsx`. The `CollaborativeEditor` component currently returns a vertical stack inside `<div className="relative flex h-full flex-col">`. Make these changes:

1. Add imports:

```ts
import { DocumentPanel } from './DocumentPanel.tsx';
import { useDocPanel } from '@/lib/notes/use-doc-panel.ts';
```

2. Inside `CollaborativeEditor`, add the panel state next to the other hooks (near `tUpload` / `saveState`):

```ts
  const [panelOpen, togglePanel] = useDocPanel();
```

3. Add a `tPanel` translations hook beside `tUpload`:

```ts
  const tPanel = useTranslations('notes.docPanel');
```

4. Add a toggle button to the header bar — the `<div className="flex items-center gap-3">` that holds `SaveIndicator` and `CopyMarkdownButton`. Add it as the last child of that flex row:

```tsx
          <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
          <CopyMarkdownButton editor={editor} />
          <button
            type="button"
            className="text-muted-foreground/70 hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded text-sm"
            aria-label={panelOpen ? tPanel('hide') : tPanel('show')}
            aria-pressed={panelOpen}
            title={panelOpen ? tPanel('hide') : tPanel('show')}
            onClick={togglePanel}
          >
            <span aria-hidden="true">☰</span>
          </button>
```

5. Change the component's outer layout to a horizontal split — the existing vertical editor stack on the left, the panel on the right. Replace the single outer `<div className="relative flex h-full flex-col">…</div>` so the editor stack is wrapped and the panel is a sibling:

```tsx
  return (
    <div className="flex h-full">
      <div className="relative flex h-full flex-1 flex-col">
        {/* ── existing content: header bar, uploadError notice, EditorContent,
             EditorToolbar — unchanged, just now inside this flex-1 column ── */}
      </div>
      {panelOpen ? <DocumentPanel editor={editor} /> : null}
    </div>
  );
```

Move the entire existing inner JSX (the header `<div>`, the `{uploadError ? … : null}` block, `<EditorContent>`, `<EditorToolbar>`) **unchanged** into the new `flex-1` column `<div>`. Only the outer wrapper changes (vertical `flex-col` → an outer horizontal `flex` with the editor column + the panel).

- [ ] **Step 3: Add the panel styling**

Append to the end of `apps/web/src/app/globals.css`:

```css
/* Document panel — a fixed-width navigation column right of the editor. */
.doc-panel {
  width: 280px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  border-left: 1px solid var(--color-paper-line, #d8d2c4);
  padding: 1rem 0.85rem;
  font-size: 0.85rem;
}
.doc-panel-section {
  margin-bottom: 1.25rem;
}
.doc-panel-heading {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted-foreground);
  margin-bottom: 0.4rem;
}
.doc-panel-subheading {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--color-muted-foreground);
  margin: 0.5rem 0 0.2rem;
}
.doc-panel-empty {
  color: var(--color-muted-foreground);
  font-style: italic;
}
.doc-panel-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.doc-panel-outline-row,
.doc-panel-asset-row,
.doc-panel-link-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
  padding: 0.2rem 0.25rem;
  border-radius: 4px;
  color: var(--color-foreground);
}
.doc-panel-outline-row:hover,
.doc-panel-asset-row:hover,
.doc-panel-link-row:hover {
  background: var(--color-paper-line, #e8e3d6);
}
.doc-panel-outline-row[aria-current='true'] {
  color: var(--color-accent);
  font-weight: 600;
}
.doc-panel-asset-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}
.doc-panel-asset-thumb-fallback {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 3px;
  background: var(--color-paper-line, #e8e3d6);
  color: var(--color-muted-foreground);
  flex-shrink: 0;
}
.doc-panel-asset-label,
.doc-panel-link-row {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

NOTE: use the CSS custom-property tokens already defined in `globals.css` (A's `.note-image*` and B's `.note-pdf-chip*` blocks used `--color-accent`, `--color-foreground`, `--color-muted-foreground`, `--color-paper-line`, `--color-background`). If any token name differs, match what those existing blocks use.

- [ ] **Step 4: Add the new component files to the coverage gate**

In `vitest.config.ts`, in `test.coverage.include`, add the four new component files next to the existing `Editor/*` entries:

```ts
        'apps/web/src/components/notes/Editor/DocumentPanel.tsx',
        'apps/web/src/components/notes/Editor/OutlineSection.tsx',
        'apps/web/src/components/notes/Editor/AssetSection.tsx',
        'apps/web/src/components/notes/Editor/LinksSection.tsx',
```

(`doc-outline.ts` and `use-doc-panel.ts` are already covered by the existing `apps/web/src/lib/notes/**/*.ts` glob.)

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun run lint`
Expected: PASS (the pre-existing `<img>` warning in `ResizableImage.tsx` is acceptable; the new `AssetSection.tsx` `<img>` carries a `biome-ignore` so it must not add a new error).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/Editor/NoteEditor.tsx apps/web/src/app/globals.css apps/web/messages/en.json apps/web/messages/de.json vitest.config.ts
git commit -m "feat(notes): wire the document panel into the editor"
```

---

## Task 8: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Type + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 2: Full test suite with coverage**

Ensure Postgres + Redis are running (`docker ps`; `make up` if not). Run:

Run: `bun run test --coverage`
Expected: PASS — all tests green; coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The new coverage-gated files — `doc-outline.ts`, `use-doc-panel.ts`, `DocumentPanel.tsx`, `OutlineSection.tsx`, `AssetSection.tsx`, `LinksSection.tsx` — must each stay above threshold.

- [ ] **Step 3: If coverage dips below threshold**

Identify the uncovered lines from the report and add targeted tests to the matching `*.test.ts(x)` file. Re-run Step 2. Commit any added tests:

```bash
git add apps/web/src
git commit -m "test(notes): close coverage gap in the document panel"
```

If coverage is already fine, skip this step.

- [ ] **Step 4: Next build**

Run: `bun run build`
Expected: the Next build of `apps/web` completes with no error. (The pre-existing worker `bun build` multi-entry-output error is unrelated and predates this work — note it but do not act on it.)

- [ ] **Step 5: Working tree check**

Run: `git status --short`
Expected: no uncommitted changes from this plan's files. Pre-existing untracked items (`.vscode/`, `bunfig.toml`, `scripts/`) and a regenerated `apps/web/next-env.d.ts` are unrelated — report but do not commit them.

---

## Self-Review

**Spec coverage:**
- Spec §1 (derive lists from the editor doc) → Task 2 (`doc-outline.ts`). ✅
- Spec §2 (layout, placement, toggle) → Task 1 (`useDocPanel`) + Task 7 (horizontal split + toggle button). ✅
- Spec §3 (outline + click-to-jump + scroll-spy) → Task 3 (`OutlineSection`) + Task 6 (`DocumentPanel` scroll-spy + `handleSelect`). ✅
- Spec §4 (Images section, thumbnails) + §5 (PDFs section, preview thumbnails, placeholder) → Task 4 (`AssetSection`). ✅
- Spec §6 (Links section, internal/external, click behaviour) → Task 5 (`LinksSection`) + Task 2 (classification). ✅
- Spec §7 (click-to-scroll mechanics) → Task 6 (`handleSelect` — `setNodeSelection`/`setTextSelection` + `scrollIntoView`). ✅
- Spec §8 (i18n `notes.docPanel`, both locales) → Task 7 Step 1. ✅
- Testing section → every task is TDD; the four new component files added to `vitest.config.ts` in Task 7. ✅

**Placeholder scan:** No TBD/TODO. The "verify against the installed package" notes (Task 2 — the `@tiptap/pm/model` import path; Task 5 — `typedRoutes` and the `Link` href type; Task 6 — the Tiptap update-event and selection-command API) are explicit, bounded verification directives against named packages — the same pattern A's and B's plans used and their reviews accepted — not vague placeholders.

**Type consistency:** `OutlineHeading` / `AssetItem` / `DocLink` / `DocItems` are defined once in `doc-outline.ts` (Task 2) and imported by `OutlineSection` (Task 3), `AssetSection` (Task 4), `LinksSection` (Task 5), and `DocumentPanel` (Task 6). The section components are presentational — props are `{ data, callbacks }`; `DocumentPanel` supplies them and owns the `editor`. `useDocPanel` (Task 1) returns `[open, toggle]` and is consumed only by `NoteEditor.tsx` (Task 7). `deriveDocItems(doc, origin)` (Task 2) is called by `DocumentPanel` (Task 6). `AssetItem.previewSrc` is the image `src` for images and `/api/assets/<id>/preview` for PDFs — consumed by `AssetSection`'s `<img src>`. The `pos` on every derived item is produced by `doc.descendants` (Task 2) and consumed by `DocumentPanel.handleSelect` (Task 6). The i18n namespace `notes.docPanel` (Task 7) matches every `useTranslations('notes.docPanel')` call in Tasks 3, 5, 6.
