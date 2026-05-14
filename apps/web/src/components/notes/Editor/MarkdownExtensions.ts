import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import type * as Y from 'yjs';

type AwarenessLike = {
  setLocalStateField: (field: string, value: unknown) => void;
  getStates: () => Map<number, unknown>;
};

/**
 * Tiptap extension list for the note editor.
 *
 * StarterKit covers headings, lists, code, blockquote, etc. Collaboration
 * wires the Y.Doc; CollaborationCaret renders remote cursors via the
 * y-protocols awareness instance. We deliberately leave Image / FileHandler
 * out — uploads are out of scope for v1 (no asset store yet, ADR/spec).
 */
export const buildExtensions = (input: {
  doc: Y.Doc;
  awareness: AwarenessLike;
  user: { name: string; color: string };
}) => [
  // StarterKit in v3 manages history internally; CollaborationCaret + the
  // Y.Doc handle multi-user undo. We rely on StarterKit defaults.
  StarterKit,
  Link.configure({ openOnClick: false, autolink: true }),
  Typography,
  TaskList,
  TaskItem.configure({ nested: true }),
  Collaboration.configure({ document: input.doc }),
  CollaborationCaret.configure({ provider: { awareness: input.awareness }, user: input.user }),
];
