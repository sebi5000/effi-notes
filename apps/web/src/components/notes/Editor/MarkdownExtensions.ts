import type { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import FileHandler from '@tiptap/extension-file-handler';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import type * as Y from 'yjs';
import { assetsApi } from '@/lib/notes/api-client.ts';
import { Callout } from './CalloutExtension.ts';
import { NoteImage } from './ImageExtension.ts';

type AwarenessLike = {
  setLocalStateField: (field: string, value: unknown) => void;
  getStates: () => Map<number, unknown>;
};

/**
 * Tiptap extension list for the note editor.
 *
 * StarterKit covers headings, lists, code, blockquote, etc. Collaboration
 * wires the Y.Doc; CollaborationCaret renders remote cursors via the
 * y-protocols awareness instance. FileHandler intercepts drag-drop and paste
 * events for image files and uploads them via assetsApi before inserting an
 * image node.
 */
export const buildExtensions = (input: {
  doc: Y.Doc;
  awareness: AwarenessLike;
  user: { name: string; color: string };
  noteId: string;
}) => {
  const uploadAndInsert = (editor: Editor, file: File, pos: number): void => {
    void assetsApi
      .upload(input.noteId, file)
      .then(({ url }) => {
        editor
          .chain()
          .insertContentAt(pos, { type: 'image', attrs: { src: url } })
          .run();
      })
      .catch(() => {
        // upload failed — the editor stays usable
      });
  };

  return [
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
    NoteImage,
    FileHandler.configure({
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      onDrop: (currentEditor, files, pos) => {
        for (const file of files) uploadAndInsert(currentEditor, file, pos);
      },
      onPaste: (currentEditor, files) => {
        for (const file of files) {
          uploadAndInsert(currentEditor, file, currentEditor.state.selection.anchor);
        }
      },
    }),
    Collaboration.configure({ document: input.doc }),
    CollaborationCaret.configure({ provider: { awareness: input.awareness }, user: input.user }),
  ];
};
