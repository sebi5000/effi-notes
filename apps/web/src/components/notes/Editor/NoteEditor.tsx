'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type { TagItem } from '@/lib/api/schemas.ts';
import { ApiError, collabApi, notesApi } from '@/lib/notes/api-client.ts';
import { nextAutoTitle } from '@/lib/notes/auto-title.ts';
import { DOC_PANEL_NARROW_QUERY } from '@/lib/notes/breakpoints.ts';
import { deriveDocItems, referencedAssetIds } from '@/lib/notes/doc-outline.ts';
import { initialSaveState, reduceSaveState } from '@/lib/notes/save-state.ts';
import { useDocPanel } from '@/lib/notes/use-doc-panel.ts';
import { useResponsiveCollapse } from '@/lib/notes/use-responsive-collapse.ts';
import { AppointmentOverlay } from './AppointmentOverlay.tsx';
import { CopyMarkdownButton } from './CopyMarkdownButton.tsx';
import { DeleteNoteButton } from './DeleteNoteButton.tsx';
import { DocumentPanel } from './DocumentPanel.tsx';
import { EditorToolbar } from './EditorToolbar.tsx';
import { buildExtensions, type UploadErrorDetail } from './MarkdownExtensions.ts';
import { initialsFromName, PresenceBar, type PresenceUser } from './PresenceBar.tsx';
import { SaveIndicator } from './SaveIndicator.tsx';
import { TagBar } from './TagBar.tsx';

type Props = {
  noteId: string;
  initialTitle: string;
  initialBody: string;
  initialBodyVersion: number;
  titleManuallySet: boolean;
  currentUser: { id: string; name: string; color: string };
  onTitleChange: (title: string) => void;
  noteTags: ReadonlyArray<TagItem>;
  allTags: ReadonlyArray<TagItem>;
  onTagsChange: (tagIds: string[]) => Promise<void>;
  onCreateTag: (name: string) => Promise<TagItem>;
};

const PRESENCE_COLORS = ['#C26A20', '#7C3F00', '#4B5066', '#1E2230', '#A03A2B', '#9B6A2F'] as const;

const pickColor = (n: number): string =>
  PRESENCE_COLORS[Math.abs(n) % PRESENCE_COLORS.length] ?? '#C26A20';

/** i18n keys under `notes.editorUpload` for a failed asset upload. */
type UploadErrorKey = 'imageFailed' | 'pdfFailed' | 'tooLarge' | 'unsupported';

/**
 * Picks the message key for a failed upload — a reason-specific message when
 * the server gave an actionable status (413 too large, 415 unsupported),
 * otherwise a file-type-aware fallback so an image and a PDF never show the
 * wrong message.
 */
const uploadErrorKey = (detail: UploadErrorDetail): UploadErrorKey => {
  if (detail.status === 413) return 'tooLarge';
  if (detail.status === 415) return 'unsupported';
  return detail.kind === 'pdf' ? 'pdfFailed' : 'imageFailed';
};

/**
 * Outer component: owns the Y.Doc and the WebSocket lifecycle. Renders a
 * lightweight skeleton while the collab session is being established, then
 * mounts the inner editor once the provider exists. Splitting like this
 * avoids calling useEditor with an empty extensions list — Tiptap requires
 * a Schema (with a `doc` top-level node) at mount time, and the cleanest
 * way to satisfy that is to not mount until the schema is ready.
 */
export function NoteEditor({
  noteId,
  initialTitle,
  initialBody,
  initialBodyVersion,
  titleManuallySet,
  currentUser,
  onTitleChange,
  noteTags,
  allTags,
  onTagsChange,
  onCreateTag,
}: Props) {
  // The parent passes `key={noteId}` so this component remounts per note
  // and we get a fresh Y.Doc without depending on noteId here.
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [presence, setPresence] = useState<ReadonlyArray<PresenceUser>>([]);
  const [connError, setConnError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let wsProvider: WebsocketProvider | null = null;
    (async () => {
      try {
        const { url, token } = await collabApi.issueToken(noteId);
        if (cancelled) return;
        const parsed = new URL(url);
        const serverUrl = `${parsed.protocol}//${parsed.host}`;
        wsProvider = new WebsocketProvider(serverUrl, `yjs/${noteId}`, ydoc, {
          params: { token },
        });
        setProvider(wsProvider);
        wsProvider.awareness.setLocalStateField('user', {
          name: currentUser.name,
          color: currentUser.color,
        });
        const updatePresence = () => {
          const states = wsProvider?.awareness.getStates();
          if (!states) return;
          const users: PresenceUser[] = [];
          for (const [clientId, state] of states.entries()) {
            if (clientId === wsProvider?.awareness.clientID) continue;
            const u = (state as { user?: { name?: string; color?: string } }).user;
            users.push({
              clientId,
              initials: initialsFromName(u?.name ?? null),
              colorHex: u?.color ?? pickColor(clientId),
            });
          }
          setPresence(users);
        };
        wsProvider.awareness.on('change', updatePresence);
        updatePresence();
      } catch {
        if (!cancelled) setConnError(true);
      }
    })();
    return () => {
      cancelled = true;
      wsProvider?.destroy();
      ydoc.destroy();
    };
  }, [noteId, ydoc, currentUser.color, currentUser.name]);

  if (provider === null) {
    return <NoteEditorSkeleton viewerCount={1} error={connError} />;
  }

  return (
    <CollaborativeEditor
      noteId={noteId}
      ydoc={ydoc}
      provider={provider}
      presence={presence}
      initialTitle={initialTitle}
      initialBody={initialBody}
      initialBodyVersion={initialBodyVersion}
      titleManuallySet={titleManuallySet}
      currentUser={currentUser}
      onTitleChange={onTitleChange}
      noteTags={noteTags}
      allTags={allTags}
      onTagsChange={onTagsChange}
      onCreateTag={onCreateTag}
    />
  );
}

function NoteEditorSkeleton({ viewerCount, error }: { viewerCount: number; error: boolean }) {
  const t = useTranslations('notes.saveIndicator');
  return (
    <div className="flex h-full flex-col">
      <div className="border-paper-line/60 mb-4 flex items-center justify-between border-b pb-2">
        <div className="text-muted-foreground/70 text-xs">{t(error ? 'offline' : 'saving')}</div>
        <span className="text-muted-foreground/60 text-xs">
          {viewerCount > 1 ? `${viewerCount} viewing` : null}
        </span>
      </div>
      <div className="prose-paper text-muted-foreground/60 min-h-[60vh] animate-pulse">
        Connecting…
      </div>
    </div>
  );
}

function CollaborativeEditor({
  noteId,
  ydoc,
  provider,
  presence,
  initialTitle,
  initialBody,
  initialBodyVersion,
  titleManuallySet,
  currentUser,
  onTitleChange,
  noteTags,
  allTags,
  onTagsChange,
  onCreateTag,
}: {
  noteId: string;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  presence: ReadonlyArray<PresenceUser>;
  initialTitle: string;
  initialBody: string;
  initialBodyVersion: number;
  titleManuallySet: boolean;
  currentUser: { id: string; name: string; color: string };
  onTitleChange: (title: string) => void;
  noteTags: ReadonlyArray<TagItem>;
  allTags: ReadonlyArray<TagItem>;
  onTagsChange: (tagIds: string[]) => Promise<void>;
  onCreateTag: (name: string) => Promise<TagItem>;
}) {
  const tUpload = useTranslations('notes.editorUpload');
  const tPanel = useTranslations('notes.docPanel');
  const tActions = useTranslations('notes.editorActions');
  const [saveState, dispatch] = useReducer(reduceSaveState, initialSaveState);
  const [baseBodyVersion, setBaseBodyVersion] = useState(initialBodyVersion);
  const [uploadError, setUploadError] = useState<UploadErrorDetail | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [persistedPanelOpen, togglePersistedPanel] = useDocPanel();
  const { collapsed: panelCollapsed, toggle: togglePanel } = useResponsiveCollapse({
    query: DOC_PANEL_NARROW_QUERY,
    collapsed: !persistedPanelOpen,
    toggle: togglePersistedPanel,
  });
  const panelOpen = !panelCollapsed;
  const [currentTitle, setCurrentTitle] = useState(initialTitle);

  const editor = useEditor(
    {
      extensions: buildExtensions({
        doc: ydoc,
        awareness: provider.awareness as unknown as {
          setLocalStateField: (k: string, v: unknown) => void;
          getStates: () => Map<number, unknown>;
        },
        user: { name: currentUser.name, color: currentUser.color },
        noteId,
        onUploadError: (detail) => setUploadError(detail),
      }),
      content: initialBody,
      editorProps: {
        attributes: {
          // `a4-sheet` sizes the editable surface to a real DIN-A4 page so
          // the on-screen layout maps 1:1 to a PDF export.
          class: 'prose-paper a4-sheet focus:outline-none',
        },
      },
      onUpdate: () => dispatch({ kind: 'edit' }),
      immediatelyRender: false,
    },
    [provider, ydoc],
  );

  useEffect(() => {
    if (!editor) return;
    const interval = window.setInterval(async () => {
      if (saveState !== 'dirty') return;
      try {
        dispatch({ kind: 'save-start' });
        const text = editor.getText();
        const assetIds = referencedAssetIds(editor.state.doc);
        const res = await notesApi.putBody(noteId, { body: text, baseBodyVersion, assetIds });
        setBaseBodyVersion(res.bodyVersion);
        dispatch({ kind: 'save-ok' });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          dispatch({ kind: 'save-conflict' });
        } else {
          dispatch({ kind: 'save-network-error' });
        }
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [editor, noteId, saveState, baseBodyVersion]);

  // Auto-title: every 2 s, derive the first heading from the doc and sync the
  // note title when it differs and the title is not manually pinned.
  useEffect(() => {
    if (!editor || titleManuallySet) return;
    const interval = window.setInterval(async () => {
      const heading = deriveDocItems(editor.state.doc, window.location.origin).headings[0]?.text;
      const next = nextAutoTitle(heading, currentTitle, titleManuallySet);
      if (next === null) return;
      try {
        await notesApi.patch(noteId, { title: next });
        setCurrentTitle(next);
        onTitleChange(next);
      } catch {
        // keep the current title; retry on the next tick
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [editor, noteId, currentTitle, titleManuallySet, onTitleChange]);

  // Auto-dismiss the upload-failure notice so it stays transient and
  // non-blocking — the user can also close it early via the dismiss button.
  useEffect(() => {
    if (!uploadError) return;
    const timer = window.setTimeout(() => setUploadError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [uploadError]);

  // Auto-dismiss the delete-failure notice — same transient treatment as the
  // upload-error notice above.
  useEffect(() => {
    if (!deleteError) return;
    const timer = window.setTimeout(() => setDeleteError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [deleteError]);

  return (
    <div className="flex h-full justify-center">
      <div className="relative flex h-full min-w-0 max-w-[212mm] flex-1 flex-col">
        <div className="border-paper-line/60 mb-4 flex items-center justify-between border-b pb-2">
          <PresenceBar users={presence} />
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
            <CopyMarkdownButton editor={editor} />
            <DeleteNoteButton noteId={noteId} noteTitle={initialTitle} onError={setDeleteError} />
          </div>
        </div>
        <TagBar
          tags={noteTags}
          allTags={allTags}
          onChange={onTagsChange}
          onCreateTag={onCreateTag}
        />
        {uploadError ? (
          <div
            role="alert"
            className="text-danger mb-2 flex items-center justify-between gap-2 rounded bg-red-50 px-2 py-1 text-xs"
          >
            <span>{tUpload(uploadErrorKey(uploadError))}</span>
            <button type="button" onClick={() => setUploadError(null)} className="underline">
              {tUpload('dismiss')}
            </button>
          </div>
        ) : null}
        {deleteError ? (
          <div
            role="alert"
            className="text-danger mb-2 flex items-center justify-between gap-2 rounded bg-red-50 px-2 py-1 text-xs"
          >
            <span>{deleteError}</span>
            <button type="button" onClick={() => setDeleteError(null)} className="underline">
              {tActions('dismiss')}
            </button>
          </div>
        ) : null}
        {/* The A4 sheet scales to fit the rail on narrow viewports (the `zoom`
            rule in globals.css). `overflow-x-auto` is a safety net for browsers
            that do not support `zoom` in `@media screen`. */}
        <EditorContent editor={editor} className="editor-rail flex-1 overflow-x-auto pb-24" />
        <EditorToolbar editor={editor} />
        {/* `$$` appointment-picker overlay (ADR 0031). Pure consumer of the
            suggestion store; renders nothing when closed. */}
        <AppointmentOverlay />
      </div>
      {panelOpen ? (
        <DocumentPanel editor={editor} onCollapse={togglePanel} />
      ) : (
        <button
          type="button"
          aria-label={tPanel('show')}
          title={tPanel('show')}
          onClick={togglePanel}
          className="text-muted-foreground/60 hover:text-foreground mr-1 mt-3 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-sm leading-none"
        >
          <span aria-hidden="true">«</span>
        </button>
      )}
    </div>
  );
}
