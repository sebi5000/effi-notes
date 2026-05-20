import type { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import FileHandler from '@tiptap/extension-file-handler';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import type * as Y from 'yjs';
import { ApiError, assetsApi } from '@/lib/notes/api-client.ts';
import { Callout } from './CalloutExtension.ts';
import { NoteImage } from './ImageExtension.ts';
import { PdfChipNode } from './PdfChipExtension.ts';
import { tableExtensions } from './TableExtension.ts';

type AwarenessLike = {
  setLocalStateField: (field: string, value: unknown) => void;
  getStates: () => Map<number, unknown>;
};

/**
 * Describes a failed asset upload so the editor can surface a precise,
 * file-type-aware message instead of a generic one.
 */
export type UploadErrorDetail = {
  /** Which kind of asset the user tried to upload. */
  kind: 'image' | 'pdf';
  /** HTTP status from the upload API, or `null` if the request never completed. */
  status: number | null;
};

/**
 * Tiptap extension list for the note editor.
 *
 * StarterKit covers headings, lists, code, blockquote, etc. Collaboration
 * wires the Y.Doc; CollaborationCaret renders remote cursors via the
 * y-protocols awareness instance. FileHandler intercepts drag-drop and paste
 * events for image and PDF files and uploads them via assetsApi before
 * inserting an image or pdfChip node.
 */
export const buildExtensions = (input: {
  doc: Y.Doc;
  awareness: AwarenessLike;
  user: { name: string; color: string };
  noteId: string;
  onUploadError: (detail: UploadErrorDetail) => void;
}) => {
  // Each dropped/pasted file uploads independently and inserts at its
  // originally-captured position once it resolves. When several files are
  // dropped or pasted at once, slower uploads land after faster ones, so the
  // inserted nodes may not preserve drop order — an accepted v1 limitation.
  const uploadAndInsert = (editor: Editor, file: File, pos: number): void => {
    void assetsApi
      .upload(input.noteId, file)
      .then(({ id, url }) => {
        const content =
          file.type === 'application/pdf'
            ? {
                type: 'pdfChip',
                attrs: { assetId: id, src: url, filename: file.name, byteSize: file.size },
              }
            : { type: 'image', attrs: { src: url } };
        editor.chain().insertContentAt(pos, content).run();
      })
      .catch((err: unknown) => {
        // upload failed — surface a non-blocking, file-type-aware notice;
        // the editor stays usable.
        input.onUploadError({
          kind: file.type === 'application/pdf' ? 'pdf' : 'image',
          status: err instanceof ApiError ? err.status : null,
        });
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
    // `multicolor: true` lets the menubar set per-mark colours (yellow,
    // green, blue, red) via `setHighlight({ color })`. Rendered as
    // <mark data-color="…" style="background-color: …">; the per-theme
    // legibility tweaks live in `globals.css`.
    Highlight.configure({ multicolor: true }),
    Typography,
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    NoteImage,
    PdfChipNode,
    ...tableExtensions,
    FileHandler.configure({
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'],
      onDrop: (currentEditor, files, pos) => {
        for (const file of files) {
          uploadAndInsert(currentEditor, file, pos);
        }
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
