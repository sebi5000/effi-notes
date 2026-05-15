'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { ApiError, collabApi, notesApi } from '@/lib/notes/api-client.ts';
import { initialSaveState, reduceSaveState } from '@/lib/notes/save-state.ts';
import { CopyMarkdownButton } from './CopyMarkdownButton.tsx';
import { EditorToolbar } from './EditorToolbar.tsx';
import { buildExtensions } from './MarkdownExtensions.ts';
import { initialsFromName, PresenceBar, type PresenceUser } from './PresenceBar.tsx';
import { SaveIndicator } from './SaveIndicator.tsx';

type Props = {
  noteId: string;
  initialTitle: string;
  initialBody: string;
  initialUpdatedAt: string;
  currentUser: { id: string; name: string; color: string };
};

const PRESENCE_COLORS = ['#C26A20', '#7C3F00', '#4B5066', '#1E2230', '#A03A2B', '#9B6A2F'] as const;

const pickColor = (n: number): string =>
  PRESENCE_COLORS[Math.abs(n) % PRESENCE_COLORS.length] ?? '#C26A20';

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
  initialTitle: _initialTitle,
  initialBody,
  initialUpdatedAt,
  currentUser,
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
      initialBody={initialBody}
      initialUpdatedAt={initialUpdatedAt}
      currentUser={currentUser}
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
  initialBody,
  initialUpdatedAt,
  currentUser,
}: {
  noteId: string;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  presence: ReadonlyArray<PresenceUser>;
  initialBody: string;
  initialUpdatedAt: string;
  currentUser: { id: string; name: string; color: string };
}) {
  const [saveState, dispatch] = useReducer(reduceSaveState, initialSaveState);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(initialUpdatedAt);

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
        const res = await notesApi.putBody(noteId, { body: text, baseUpdatedAt });
        setBaseUpdatedAt(res.updatedAt);
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
  }, [editor, noteId, saveState, baseUpdatedAt]);

  return (
    <div className="relative flex h-full flex-col">
      <div className="border-paper-line/60 mb-4 flex items-center justify-between border-b pb-2">
        <PresenceBar users={presence} />
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
          <CopyMarkdownButton editor={editor} />
        </div>
      </div>
      {/* The A4 sheet has a fixed 210mm width — center it and let the rail
          scroll horizontally on narrow viewports rather than clipping. */}
      <EditorContent editor={editor} className="flex-1 overflow-x-auto pb-24" />
      <EditorToolbar editor={editor} />
    </div>
  );
}
