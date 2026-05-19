import { generateHTML } from '@tiptap/html';
import DOMPurify from 'isomorphic-dompurify';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { buildRenderExtensions } from '@/components/notes/Editor/render-extensions.ts';

/**
 * Server-side renderer for the public-note viewer (ADR 0028).
 *
 * A note's rich document lives in `Note.yjsState` (a Yjs CRDT). This module
 * decodes it to ProseMirror JSON (`y-prosemirror`), renders it to HTML against
 * the shared schema (`buildRenderExtensions`), and sanitises the result —
 * the output is shown on an account-less page, so it is treated as untrusted.
 *
 * When `yjsState` is absent (a note never opened in the collaborative editor)
 * the plain-text `Note.body` mirror is escaped and rendered as a fallback.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** Plain-text body → minimally-formatted, fully-escaped HTML (newlines kept). */
const plainTextFallback = (body: string): string => {
  const trimmed = body.trim();
  if (trimmed.length === 0) return '';
  return `<p>${escapeHtml(trimmed).replace(/\r?\n/g, '<br>')}</p>`;
};

/** A ProseMirror-JSON node, loosely typed — we only walk `type`/`attrs`/`content`. */
type JsonNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
};

/**
 * Walk the doc JSON and rewrite the `src` of every `image` / `pdfChip` node.
 * Used to point asset references at the token-scoped public asset route so a
 * logged-out viewer can load images and PDFs. Mutates in place.
 */
const rewriteAssetUrls = (node: JsonNode, rewrite: (src: string) => string): void => {
  if ((node.type === 'image' || node.type === 'pdfChip') && node.attrs) {
    const src = node.attrs.src;
    if (typeof src === 'string' && src.length > 0) {
      node.attrs.src = rewrite(src);
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) rewriteAssetUrls(child, rewrite);
  }
};

export type RenderNoteOptions = {
  /**
   * Rewrites an image / pdf-chip `src` to a public, token-scoped URL. When
   * omitted, asset URLs are left as stored (they will not resolve for a
   * logged-out visitor — callers serving a public page must supply this).
   */
  rewriteAssetUrl?: (src: string) => string;
};

/**
 * Render a note to sanitised HTML for the public viewer.
 *
 * @param yjsState    the note's `yjsState` snapshot, or `null`
 * @param fallbackBody the plain-text `Note.body`, used when `yjsState` is empty
 */
export const renderNoteHtml = (
  yjsState: Uint8Array | null,
  fallbackBody: string,
  options: RenderNoteOptions = {},
): string => {
  if (yjsState === null || yjsState.byteLength === 0) {
    return plainTextFallback(fallbackBody);
  }

  let html: string;
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, yjsState);
    const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')) as JsonNode;
    if (options.rewriteAssetUrl) {
      rewriteAssetUrls(json, options.rewriteAssetUrl);
    }
    html = generateHTML(json, buildRenderExtensions());
  } catch {
    // A corrupt or unreadable snapshot must never break the page — fall back.
    return plainTextFallback(fallbackBody);
  }

  // The note is author-controlled and shown on an account-less page; sanitise
  // even though the schema is constrained (defends `javascript:` hrefs etc.).
  return DOMPurify.sanitize(html);
};
