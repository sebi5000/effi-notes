import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import { AppointmentLinkNodeBase } from './appointment-link-node.ts';
import { Callout } from './CalloutExtension.ts';
import { NoteImageNode } from './image-node.ts';
import { PdfChipNodeBase } from './pdf-chip-node.ts';
import { tableExtensions } from './TableExtension.ts';

/**
 * Schema-only TipTap extension list, shared by the editor and the public-note
 * renderer (`lib/notes/render-note.ts`).
 *
 * It is the exact node/mark schema of `buildExtensions` (MarkdownExtensions.ts)
 * MINUS the editor-only behaviour extensions — `FileHandler`, `Collaboration`,
 * `CollaborationCaret` — which contribute no schema. The custom nodes use the
 * server-safe bases (`NoteImageNode`, `PdfChipNodeBase`); the editor's
 * `NoteImage` / `PdfChipNode` extend those same bases, so the document schema
 * cannot drift between editor and renderer.
 *
 * Returns a fresh array per call — TipTap mutates extension instances when
 * loaded into a schema, so a renderer and an editor must not share instances.
 */
export const buildRenderExtensions = () => [
  StarterKit.configure({ link: false, undoRedo: false }),
  Link.configure({ openOnClick: false, autolink: true }),
  Typography,
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  NoteImageNode,
  PdfChipNodeBase,
  AppointmentLinkNodeBase,
  ...tableExtensions,
];
