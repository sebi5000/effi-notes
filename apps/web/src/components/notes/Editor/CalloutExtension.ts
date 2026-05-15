import { mergeAttributes, Node } from '@tiptap/core';

/** The five supported callout types, in toolbar order. */
export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const isCalloutType = (value: unknown): value is CalloutType =>
  typeof value === 'string' && (CALLOUT_TYPES as readonly string[]).includes(value);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Insert a callout of `type` containing one empty paragraph. */
      setCallout: (type: CalloutType) => ReturnType;
    };
  }
}

/**
 * GitHub-style callout block (Note / Tip / Important / Warning / Caution).
 * Serialises as `<div data-callout="<type>" class="callout">` and holds block
 * content. The per-type colour, icon and title styling are pure CSS
 * (globals.css) — the node needs no NodeView.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note' as CalloutType,
        parseHTML: (element): CalloutType => {
          const value = element.getAttribute('data-callout');
          return isCalloutType(value) ? value : 'note';
        },
        renderHTML: (attributes) => ({ 'data-callout': attributes.type as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (type: CalloutType) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { type: isCalloutType(type) ? type : 'note' },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});
