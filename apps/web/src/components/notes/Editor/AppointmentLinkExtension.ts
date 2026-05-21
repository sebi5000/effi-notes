import { ReactNodeViewRenderer } from '@tiptap/react';
import { AppointmentChip } from './AppointmentChip.tsx';
import { AppointmentLinkNodeBase } from './appointment-link-node.ts';

/**
 * The editor's appointment-link node — the server-safe
 * `AppointmentLinkNodeBase` schema plus the `AppointmentChip` React
 * NodeView (📅 chip + attendees popover). Same split-pattern as
 * `PdfChipExtension`/`pdf-chip-node.ts` so the public-note renderer can
 * import the base without React (ADR 0031).
 */
export const AppointmentLinkExtension = AppointmentLinkNodeBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AppointmentChip);
  },
});
