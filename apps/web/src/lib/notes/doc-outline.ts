import type { Editor } from '@tiptap/core';

// Derive the ProseMirror Node type from the Editor state rather than importing
// @tiptap/pm/model directly — avoids a separate resolution path while keeping
// the parameter strictly typed.
type PMNode = Editor['state']['doc'];

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
export const deriveDocItems = (doc: PMNode, origin: string): DocItems => {
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
        const href = String(mark.attrs['href'] ?? '');
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
        level: Number(node.attrs['level']) || 1,
        text: node.textContent,
        pos,
      });
    } else if (node.type.name === 'image') {
      const src = String(node.attrs['src'] ?? '');
      images.push({
        kind: 'image',
        src,
        previewSrc: src,
        label: String(node.attrs['caption'] ?? ''),
        pos,
      });
    } else if (node.type.name === 'pdfChip') {
      const src = String(node.attrs['src'] ?? '');
      const assetId = String(node.attrs['assetId'] ?? '');
      pdfs.push({
        kind: 'pdf',
        src,
        previewSrc: assetId ? `/api/assets/${assetId}/preview` : '',
        label: String(node.attrs['filename'] ?? ''),
        pos,
      });
    }
    return true;
  });

  return { headings, images, pdfs, links };
};

/** The asset id embedded in an `/api/assets/<id>` URL, or `''` if absent. */
const assetIdFromSrc = (src: string): string => {
  const match = src.match(/\/api\/assets\/([^/?#]+)/);
  return match ? (match[1] ?? '') : '';
};

/**
 * The distinct asset IDs the document references — from `image` node `src`
 * URLs and `pdfChip` node `assetId` attributes. Used by the editor to report
 * referenced assets on save (sub-project D's cleanup reconcile).
 */
export const referencedAssetIds = (doc: PMNode): string[] => {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'image') {
      const id = assetIdFromSrc(String(node.attrs['src'] ?? ''));
      if (id !== '') ids.add(id);
    } else if (node.type.name === 'pdfChip') {
      const id = String(node.attrs['assetId'] ?? '');
      if (id !== '') ids.add(id);
    }
    return true;
  });
  return [...ids];
};
