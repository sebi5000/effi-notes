import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import type * as Y from 'yjs';
import { Callout } from './CalloutExtension.ts';

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
  // StarterKit v3 bundles its own Link and UndoRedo extensions. We disable
  // both here:
  //   - link: we add our own Link below with openOnClick/autolink config
  //   - undoRedo: Collaboration brings CRDT-aware history; keeping
  //     StarterKit's UndoRedo too causes a "not compatible" warning and
  //     double undo stacks.
  StarterKit.configure({ link: false, undoRedo: false }),
  Link.configure({ openOnClick: false, autolink: true }),
  Typography,
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  Collaboration.configure({ document: input.doc }),
  CollaborationCaret.configure({ provider: { awareness: input.awareness }, user: input.user }),
];
