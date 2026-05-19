import { ReactNodeViewRenderer } from '@tiptap/react';
import { PdfChip } from './PdfChip.tsx';
import { PdfChipNodeBase } from './pdf-chip-node.ts';

/**
 * The editor's PDF node — the server-safe `PdfChipNodeBase` schema plus the
 * `PdfChip` React NodeView (icon + filename + size + Open link).
 *
 * The schema lives in `pdf-chip-node.ts` so the public-note renderer can reuse
 * it without pulling in React; only the NodeView is added here.
 */
export const PdfChipNode = PdfChipNodeBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PdfChip);
  },
});
