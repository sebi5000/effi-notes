import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

/**
 * Tiptap Suggestion extension keyed on the literal `$$` (ADR 0031).
 *
 * When the user types `$$` the suggestion popup opens; the React surface
 * lives in `AppointmentOverlay.tsx` and is wired via the props passed to
 * `Suggestion`'s `render()` callback.
 *
 * The popup itself is owned by `MarkdownExtensions.buildExtensions` which
 * stores the latest props in a module-level subscriber so the overlay can
 * `useSyncExternalStore` them — same pattern as Tiptap mentions but
 * without the tippy.js dependency the project doesn't carry.
 *
 * The suggestion config takes a single `noteId` so it can call
 * `POST /api/notes/{noteId}/appointments` directly from the picker without
 * the overlay needing to plumb that prop down again.
 */

export type AppointmentSuggestionItem = {
  id: string;
  subject: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type AppointmentSuggestionState = {
  open: boolean;
  query: string;
  /** Caret rect in viewport coords for the overlay to anchor itself to. */
  clientRect: DOMRect | null;
  /** Inserts the picked appointment at the current suggestion range. */
  pick: (item: AppointmentSuggestionItem) => void;
  /** Aborts the suggestion (Escape / outside-click). */
  close: () => void;
};

type Listener = (state: AppointmentSuggestionState) => void;

const subscribers = new Set<Listener>();
let lastState: AppointmentSuggestionState = {
  open: false,
  query: '',
  clientRect: null,
  pick: () => undefined,
  close: () => undefined,
};

const emit = (next: AppointmentSuggestionState): void => {
  lastState = next;
  for (const s of subscribers) s(next);
};

/** External-store subscription used by AppointmentOverlay (React 18+). */
export const appointmentSuggestionStore = {
  subscribe: (listener: Listener): (() => void) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
  getSnapshot: (): AppointmentSuggestionState => lastState,
};

export const AppointmentSuggestionPluginKey = new PluginKey('appointment-suggestion');

export const AppointmentSuggestion = Extension.create<{ noteId: string }>({
  name: 'appointmentSuggestion',

  addOptions() {
    return { noteId: '' };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: AppointmentSuggestionPluginKey,
        // `$$` is two characters; Suggestion's `char` matches a single char
        // followed by optional query characters. We use `$` and require the
        // user to type another `$` immediately after — Suggestion's default
        // behaviour does NOT support multi-char triggers cleanly, so the
        // `allowSpaces` + `startOfLine: false` config lets `$$` come from
        // anywhere mid-paragraph.
        char: '$',
        // Only activate when the char preceding `$` is also `$` (so single
        // `$dollar signs` in math text don't open the popup).
        allow: ({ state, range }) => {
          const before = state.doc.textBetween(Math.max(0, range.from - 1), range.from);
          return before === '$';
        },
        allowSpaces: true,
        startOfLine: false,
        command: ({ editor, range, props }) => {
          const item = props as AppointmentSuggestionItem;
          // Replace `$$query` with the appointment chip.
          editor
            .chain()
            .focus()
            // The range starts after the trigger char; back it up one to
            // also consume the leading `$` we held back from `char`.
            .deleteRange({ from: range.from - 1, to: range.to })
            .insertContent({
              type: 'appointmentLink',
              attrs: { appointmentId: item.id, subject: item.subject },
            })
            .insertContent(' ')
            .run();
        },
        render: () => {
          let pickHandler: (item: AppointmentSuggestionItem) => void = () => undefined;
          let closeHandler: () => void = () => undefined;
          return {
            onStart: (props) => {
              pickHandler = (item) => props.command(item);
              closeHandler = () => emit({ ...lastState, open: false, clientRect: null });
              emit({
                open: true,
                query: props.query,
                clientRect: props.clientRect?.() ?? null,
                pick: pickHandler,
                close: closeHandler,
              });
            },
            onUpdate: (props) => {
              pickHandler = (item) => props.command(item);
              emit({
                open: true,
                query: props.query,
                clientRect: props.clientRect?.() ?? null,
                pick: pickHandler,
                close: closeHandler,
              });
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                closeHandler();
                return true;
              }
              return false;
            },
            onExit: () => {
              emit({ ...lastState, open: false, clientRect: null });
            },
          };
        },
      }),
    ];
  },
});
