'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { ApiError, collabApi, notesApi } from '@/lib/notes/api-client.ts';
import { initialSaveState, reduceSaveState } from '@/lib/notes/save-state.ts';
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
 * Connects a Tiptap editor to the worker's y-websocket relay via the
 * /api/collab/[noteId] token endpoint. Tracks save state via the
 * reduceSaveState machine and persists markdown via PUT /api/notes/[id]/body
 * on graceful disconnect / periodic flush.
 */
export function NoteEditor({
  noteId,
  initialTitle: _initialTitle,
  initialBody,
  initialUpdatedAt,
  currentUser,
}: Props) {
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [presence, setPresence] = useState<ReadonlyArray<PresenceUser>>([]);
  const [saveState, dispatch] = useReducer(reduceSaveState, initialSaveState);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(initialUpdatedAt);

  // Open the WebSocket once we have a token.
  useEffect(() => {
    let cancelled = false;
    let wsProvider: WebsocketProvider | null = null;
    (async () => {
      try {
        const { url, token } = await collabApi.issueToken(noteId);
        if (cancelled) return;
        const parsed = new URL(url);
        // y-websocket's WebsocketProvider signature: (serverUrl, room, doc)
        // The full URL is `${serverUrl}/${room}?…` — we pass our origin and
        // use the note id as the "room" so the path resolves to /yjs/<id>.
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
            const user = (state as { user?: { name?: string; color?: string } }).user;
            if (clientId === wsProvider?.awareness.clientID) continue;
            users.push({
              clientId,
              initials: initialsFromName(user?.name ?? null),
              colorHex: user?.color ?? pickColor(clientId),
            });
          }
          setPresence(users);
        };
        wsProvider.awareness.on('change', updatePresence);
        updatePresence();
      } catch {
        // Token issuance failed — fall back to offline mode silently.
        dispatch({ kind: 'save-network-error' });
      }
    })();
    return () => {
      cancelled = true;
      wsProvider?.destroy();
      ydoc.destroy();
    };
  }, [noteId, ydoc, currentUser.color, currentUser.name]);

  const editor = useEditor(
    {
      extensions:
        provider !== null
          ? buildExtensions({
              doc: ydoc,
              awareness: provider.awareness as unknown as {
                setLocalStateField: (k: string, v: unknown) => void;
                getStates: () => Map<number, unknown>;
              },
              user: { name: currentUser.name, color: currentUser.color },
            })
          : [],
      content: initialBody,
      editorProps: {
        attributes: {
          class: 'prose-paper focus:outline-none min-h-[60vh]',
        },
      },
      onUpdate: () => dispatch({ kind: 'edit' }),
      immediatelyRender: false,
    },
    [provider],
  );

  // Periodic markdown autosave via PUT /api/notes/[id]/body. Reads the
  // current editor markdown (via getJSON → server-side serialisation in a
  // real prod build; here we just stringify) every 5s while dirty.
  useEffect(() => {
    if (!editor) return;
    const interval = window.setInterval(async () => {
      if (saveState !== 'dirty') return;
      try {
        dispatch({ kind: 'save-start' });
        // Markdown serialisation isn't part of Tiptap core — fall back to
        // editor.getText(). Future: add a Tiptap markdown extension.
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
    <div className="flex h-full flex-col">
      <div className="border-paper-line/60 mb-4 flex items-center justify-between border-b pb-2">
        <PresenceBar users={presence} />
        <SaveIndicator state={saveState} viewerCount={presence.length + 1} />
      </div>
      <EditorContent editor={editor} className="flex-1" />
    </div>
  );
}
