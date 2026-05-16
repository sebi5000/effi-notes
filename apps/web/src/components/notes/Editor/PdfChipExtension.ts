import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PdfChip } from './PdfChip.tsx';

/**
 * The editor's PDF node — an atom block rendered as a compact file chip
 * (icon + filename + size + Open link) by the `PdfChip` NodeView. Attributes
 * round-trip through `data-*` HTML attributes; `renderHTML` emits an anchor
 * so "Copy as Markdown" (Turndown) converts it to `[filename](src)`.
 */
export const PdfChipNode = Node.create({
  name: 'pdfChip',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-asset-id'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.assetId ? { 'data-asset-id': String(attrs.assetId) } : {},
      },
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('href') ?? el.getAttribute('data-src'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.src ? { href: String(attrs.src) } : {},
      },
      filename: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-filename') ?? el.textContent ?? '',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.filename ? { 'data-filename': String(attrs.filename) } : {},
      },
      byteSize: {
        default: 0,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-byte-size');
          const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
          return Number.isFinite(n) ? n : 0;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.byteSize != null ? { 'data-byte-size': String(attrs.byteSize) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-pdf-chip]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['a', { ...HTMLAttributes, 'data-pdf-chip': '' }, String(node.attrs.filename ?? '')];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfChip);
  },
});
