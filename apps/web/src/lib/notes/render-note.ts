import { generateHTML } from '@tiptap/html';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { buildRenderExtensions } from '@/components/notes/Editor/render-extensions.ts';

/**
 * Server-side renderer for the public-note viewer (ADR 0028).
 *
 * A note's rich document lives in `Note.yjsState` (a Yjs CRDT). This module
 * decodes it to ProseMirror JSON (`y-prosemirror`) and renders it to HTML
 * against the shared schema (`buildRenderExtensions`).
 *
 * Safety: the output is shown on an account-less page, so the document is
 * treated as untrusted — but the schema is the defence. `generateHTML` can
 * only emit the nodes/marks that schema defines (no `<script>`, no event
 * handlers, no raw HTML), and it escapes every text node. The one residual
 * vector is a hostile URL, so this module protocol-checks `href`/`src` on the
 * structured JSON before rendering — no DOM-based sanitiser is needed.
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

/**
 * True for a URL safe to keep in public HTML: a relative URL (no scheme), or
 * an absolute one whose scheme is http/https/mailto. Blocks `javascript:`,
 * `data:`, `vbscript:`, etc.
 */
const isSafeUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (trimmed === '') return false;
  // No leading scheme → relative URL (path / query / fragment) → safe.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  return /^(?:https?|mailto):/i.test(trimmed);
};

/** A ProseMirror-JSON node, loosely typed — we only walk `type`/`attrs`/`marks`/`content`. */
type JsonNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: JsonNode[];
};

/**
 * Walk the doc JSON in place: rewrite `image` / `pdfChip` asset `src` to the
 * public route (when a rewriter is given) and strip every hostile URL — a
 * `link` mark or an asset `src` whose protocol is not http/https/mailto.
 */
const sanitizeNode = (node: JsonNode, rewriteAssetUrl?: (src: string) => string): void => {
  if (Array.isArray(node.marks)) {
    // Drop link marks pointing at an unsafe protocol (javascript:, data:, …).
    node.marks = node.marks.filter((mark) => {
      if (mark.type !== 'link') return true;
      const href = mark.attrs?.href;
      return typeof href === 'string' && isSafeUrl(href);
    });
  }

  if ((node.type === 'image' || node.type === 'pdfChip') && node.attrs) {
    const raw = node.attrs.src;
    if (typeof raw === 'string') {
      const src = rewriteAssetUrl ? rewriteAssetUrl(raw) : raw;
      // A hostile src is dropped rather than rendered.
      node.attrs.src = isSafeUrl(src) ? src : null;
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) sanitizeNode(child, rewriteAssetUrl);
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
 * Render a note to HTML for the public viewer.
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

  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, yjsState);
    const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')) as JsonNode;
    sanitizeNode(json, options.rewriteAssetUrl);
    // `json` is a valid ProseMirror doc; `JsonNode` is only the loose shape the
    // sanitiser walks — cast back to the type generateHTML expects.
    return generateHTML(json as Parameters<typeof generateHTML>[0], buildRenderExtensions());
  } catch {
    // A corrupt or unreadable snapshot must never break the page — fall back.
    return plainTextFallback(fallbackBody);
  }
};
