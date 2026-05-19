import Image from '@tiptap/extension-image';

/**
 * Schema-only image node: `@tiptap/extension-image` extended with a numeric
 * `width` (resize) and a `caption`, both round-tripping through HTML
 * attributes.
 *
 * This module deliberately imports **no** React / NodeView code so it is safe
 * to load server-side — the public-note renderer (`lib/notes/render-note.ts`)
 * reuses it to build a schema. `ImageExtension.ts` extends this base with the
 * editor's `ResizableImage` NodeView.
 */
export const NoteImageNode = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('width') ?? element.getAttribute('data-width');
          const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: String(attributes.width) } : {}),
      },
      caption: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-caption') ?? element.getAttribute('alt') ?? '',
        renderHTML: (attributes) =>
          attributes.caption ? { 'data-caption': String(attributes.caption) } : {},
      },
    };
  },
});
