import { Node } from '@tiptap/core';

/**
 * Schema-only inline appointment-link node (ADR 0031).
 *
 * Renders an inline atom carrying two attrs:
 *   `appointmentId` — the Microsoft Graph event id (canonical key)
 *   `subject`       — snapshot of the event subject so the chip text shows
 *                     even when Graph is unreachable or the viewer hasn't
 *                     connected their M365
 *
 * Markup is a `<span data-appointment-id data-subject>` with a 📅 prefix in
 * the text body so the public renderer (which uses THIS base, no React) reads
 * coherently:
 *
 *     The roadmap was finalised in <span data-appointment-id="…" data-subject="Q4 Review">📅 Q4 Review</span>.
 *
 * No React in this file — the editor's NodeView (`AppointmentChip.tsx`)
 * extends this base in `AppointmentLinkExtension.ts`.
 */
export const AppointmentLinkNodeBase = Node.create({
  name: 'appointmentLink',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      appointmentId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-appointment-id'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.appointmentId ? { 'data-appointment-id': String(attrs.appointmentId) } : {},
      },
      subject: {
        default: '',
        parseHTML: (el: HTMLElement) =>
          el.getAttribute('data-subject') ?? el.textContent?.replace(/^📅\s*/, '') ?? '',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.subject ? { 'data-subject': String(attrs.subject) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-appointment-id]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      { ...HTMLAttributes, class: 'note-appointment-chip' },
      `📅 ${String(node.attrs.subject ?? '')}`,
    ];
  },
});
