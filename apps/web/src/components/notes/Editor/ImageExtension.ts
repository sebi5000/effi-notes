import { ReactNodeViewRenderer } from '@tiptap/react';
import { NoteImageNode } from './image-node.ts';
import { ResizableImage } from './ResizableImage.tsx';

/**
 * The editor's image node — the server-safe `NoteImageNode` schema base
 * (numeric `width` + `caption`) plus the `ResizableImage` React NodeView.
 *
 * The schema lives in `image-node.ts` so the public-note renderer can reuse
 * it without pulling in React; only the NodeView is added here.
 */
export const NoteImage = NoteImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImage);
  },
});
