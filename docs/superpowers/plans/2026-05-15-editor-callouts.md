# Editor Callouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five GitHub-style callout blocks (Note/Tip/Important/Warning/Caution) to the notes editor — inserted from a toolbar dropdown, rendered with per-type colour and icon, and exported as `> [!TYPE]` Markdown.

**Architecture:** A custom Tiptap `Callout` node (a `data-callout` div with a `type` attribute, no NodeView). Styling is pure CSS keyed on `data-callout`. A `CalloutMenu` toolbar component opens a dropdown of the five types and runs the node's `setCallout` command. A Turndown rule in `markdown.ts` handles Markdown export. No typing/paste parsing.

**Tech Stack:** Tiptap 3 (`@tiptap/core`, `@tiptap/starter-kit`), Next.js 16 / React 19, TypeScript 6 strict, TailwindCSS 4, next-intl, `turndown`, Vitest + Testing Library, Bun.

**Spec:** `docs/superpowers/specs/2026-05-15-editor-callouts-design.md`

**Conventions:**
- Run a single test file with `bun run test <path>` (forwards to `vitest run <path>`; needs no database).
- Conventional Commits; pre-commit hooks (lefthook: biome, eslint-next, repo-wide typecheck) are mandatory — fix causes, never `--no-verify`.
- TypeScript strict, no `any`. `react-hooks/set-state-in-effect` is an ESLint error — no synchronous `setState` in a `useEffect` body.
- `en.json` / `de.json` must stay key-aligned.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `apps/web/src/components/notes/Editor/CalloutExtension.ts` | **new** — the `callout` Tiptap node + `setCallout` command + type list | 1 |
| `apps/web/src/components/notes/Editor/CalloutExtension.test.ts` | **new** — extension tests (headless editor) | 1 |
| `apps/web/src/components/notes/Editor/MarkdownExtensions.ts` | register `Callout` in `buildExtensions` | 1 |
| `apps/web/src/app/globals.css` | `.callout` styling — per-type colour + icon | 2 |
| `apps/web/src/components/notes/Editor/CalloutMenu.tsx` | **new** — toolbar dropdown | 3 |
| `apps/web/src/components/notes/Editor/CalloutMenu.test.tsx` | **new** — dropdown tests | 3 |
| `apps/web/src/components/notes/Editor/EditorToolbar.tsx` | mount `CalloutMenu` in a new toolbar group | 3 |
| `apps/web/src/components/notes/Editor/EditorToolbar.test.tsx` | a case for the callout button | 3 |
| `apps/web/messages/en.json`, `de.json` | `notes.callouts` strings | 3 |
| `apps/web/src/lib/notes/markdown.ts` | Turndown rule for `div[data-callout]` | 4 |
| `apps/web/src/lib/notes/markdown.test.ts` | callout export tests | 4 |
| `vitest.config.ts` | add `CalloutExtension.ts` + `CalloutMenu.tsx` to coverage `include` | 1, 3 |

---

## Task 1: Callout node extension

**Files:**
- Create: `apps/web/src/components/notes/Editor/CalloutExtension.ts`
- Test: `apps/web/src/components/notes/Editor/CalloutExtension.test.ts`
- Modify: `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add `CalloutExtension.ts` to the coverage include list**

In `vitest.config.ts`, the `coverage.include` array lists editor files. After the line:

```ts
        'apps/web/src/components/notes/Editor/EditorToolbar.tsx',
```

add:

```ts
        'apps/web/src/components/notes/Editor/CalloutExtension.ts',
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/notes/Editor/CalloutExtension.test.ts`:

```ts
// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { CALLOUT_TYPES, Callout } from './CalloutExtension.ts';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const make = (content = '<p></p>'): Editor => {
  editor = new Editor({ extensions: [StarterKit, Callout], content });
  return editor;
};

describe('Callout extension', () => {
  it('exposes the five callout types in order', () => {
    expect(CALLOUT_TYPES).toEqual(['note', 'tip', 'important', 'warning', 'caution']);
  });

  it('setCallout inserts a callout node with the given type', () => {
    const e = make();
    e.commands.setCallout('tip');
    expect(e.getHTML()).toContain('data-callout="tip"');
    expect(e.getHTML()).toContain('class="callout"');
  });

  it('setCallout falls back to "note" for an invalid type', () => {
    const e = make();
    // @ts-expect-error — exercising the runtime type guard with a bad value
    e.commands.setCallout('bogus');
    expect(e.getHTML()).toContain('data-callout="note"');
  });

  it('parses an existing data-callout div into a callout node', () => {
    const e = make('<div data-callout="warning"><p>hi</p></div>');
    const node = e.getJSON().content?.[0];
    expect(node?.type).toBe('callout');
    expect(node?.attrs?.type).toBe('warning');
  });

  it('parses an unknown data-callout value as "note"', () => {
    const e = make('<div data-callout="xxx"><p>hi</p></div>');
    expect(e.getJSON().content?.[0]?.attrs?.type).toBe('note');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run test apps/web/src/components/notes/Editor/CalloutExtension.test.ts`
Expected: FAIL — `./CalloutExtension.ts` does not exist.

- [ ] **Step 4: Implement the extension**

Create `apps/web/src/components/notes/Editor/CalloutExtension.ts`:

```ts
import { mergeAttributes, Node } from '@tiptap/core';

/** The five supported callout types, in toolbar order. */
export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const isCalloutType = (value: unknown): value is CalloutType =>
  typeof value === 'string' && (CALLOUT_TYPES as readonly string[]).includes(value);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Insert a callout of `type` containing one empty paragraph. */
      setCallout: (type: CalloutType) => ReturnType;
    };
  }
}

/**
 * GitHub-style callout block (Note / Tip / Important / Warning / Caution).
 * Serialises as `<div data-callout="<type>" class="callout">` and holds block
 * content. The per-type colour, icon and title styling are pure CSS
 * (globals.css) — the node needs no NodeView.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note' as CalloutType,
        parseHTML: (element): CalloutType => {
          const value = element.getAttribute('data-callout');
          return isCalloutType(value) ? value : 'note';
        },
        renderHTML: (attributes) => ({ 'data-callout': attributes.type as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (type: CalloutType) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { type: isCalloutType(type) ? type : 'note' },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test apps/web/src/components/notes/Editor/CalloutExtension.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Register the extension in `MarkdownExtensions.ts`**

In `apps/web/src/components/notes/Editor/MarkdownExtensions.ts`, add the import alongside the other extension imports (alphabetical with the `./` imports — it is the only local import; place it after the `@tiptap/*` import block, before `import type * as Y from 'yjs';`):

```ts
import { Callout } from './CalloutExtension.ts';
```

Then add `Callout` to the array returned by `buildExtensions` — insert it after the `TaskItem.configure({ nested: true }),` line:

```ts
  TaskItem.configure({ nested: true }),
  Callout,
  Collaboration.configure({ document: input.doc }),
```

- [ ] **Step 7: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS — all packages exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/notes/Editor/CalloutExtension.ts apps/web/src/components/notes/Editor/CalloutExtension.test.ts apps/web/src/components/notes/Editor/MarkdownExtensions.ts vitest.config.ts
git commit -m "feat(notes): callout Tiptap node with setCallout command"
```

---

## Task 2: Callout styling

Pure CSS — no automated test. Verified by typecheck + lint + a described visual check.

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Append the callout styles**

Append to the END of `apps/web/src/app/globals.css`:

```css
/* GitHub-style callouts. The per-type colour, tint and icon are CSS custom
 * properties set on any element carrying `data-callout`, so both the editor
 * block (.callout) and the toolbar-dropdown icon (.callout-icon) consume the
 * same definitions. Icons are inline SVGs applied via `mask` so they take the
 * type colour. */
[data-callout="note"] {
  --callout-color: #3b6fd6;
  --callout-bg: #f3f7fd;
  --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9'/><line x1='12' y1='11' x2='12' y2='16'/><line x1='12' y1='8' x2='12' y2='8'/></svg>");
}
[data-callout="tip"] {
  --callout-color: #3f9142;
  --callout-bg: #f2f9f2;
  --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 18h6'/><path d='M10 22h4'/><path d='M12 2a7 7 0 0 0-4 12.8c.6.4 1 1.2 1 2.2h6c0-1 .4-1.8 1-2.2A7 7 0 0 0 12 2z'/></svg>");
}
[data-callout="important"] {
  --callout-color: #8a3fb8;
  --callout-bg: #f9f3fb;
  --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/><line x1='12' y1='7' x2='12' y2='11'/><line x1='12' y1='14.5' x2='12' y2='14.5'/></svg>");
}
[data-callout="warning"] {
  --callout-color: #b8860b;
  --callout-bg: #fcfaf0;
  --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='16.5' x2='12' y2='16.5'/></svg>");
}
[data-callout="caution"] {
  --callout-color: #d2691e;
  --callout-bg: #fcf5ef;
  --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M8 2h8l6 6v8l-6 6H8l-6-6V8z'/><line x1='12' y1='8' x2='12' y2='12'/><line x1='12' y1='15.5' x2='12' y2='15.5'/></svg>");
}

.prose-paper .callout {
  position: relative;
  margin-bottom: 0.85em;
  padding: 0.75em 1em 0.75em 2.9em;
  border-radius: 6px;
  border-left: 3px solid var(--callout-color);
  background: var(--callout-bg);
}
.prose-paper .callout::before {
  content: "";
  position: absolute;
  left: 0.95em;
  top: 0.95em;
  width: 1.2em;
  height: 1.2em;
  background-color: var(--callout-color);
  -webkit-mask: var(--callout-icon) center / contain no-repeat;
  mask: var(--callout-icon) center / contain no-repeat;
}
.prose-paper .callout > :first-child {
  margin-top: 0;
  font-weight: 600;
  color: var(--callout-color);
}
.prose-paper .callout > :last-child {
  margin-bottom: 0;
}

/* Small masked icon for the toolbar dropdown rows. */
.callout-icon {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  flex: 0 0 auto;
  background-color: var(--callout-color);
  -webkit-mask: var(--callout-icon) center / contain no-repeat;
  mask: var(--callout-icon) center / contain no-repeat;
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run lint`
Expected: PASS — Biome lints the CSS; no errors.

- [ ] **Step 3: Visual check**

You cannot run a browser. Re-read the appended CSS and confirm: five `[data-callout="..."]` blocks each define `--callout-color`, `--callout-bg`, `--callout-icon`; `.prose-paper .callout` uses the border/background; `.prose-paper .callout::before` and `.callout-icon` both apply the icon via `mask`. State this confirmation in your report.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(notes): callout block styling — per-type colour and icon"
```

---

## Task 3: Toolbar dropdown

**Files:**
- Create: `apps/web/src/components/notes/Editor/CalloutMenu.tsx`
- Test: `apps/web/src/components/notes/Editor/CalloutMenu.test.tsx`
- Modify: `apps/web/src/components/notes/Editor/EditorToolbar.tsx`
- Modify: `apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`
- Modify: `apps/web/messages/en.json`, `de.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the i18n strings**

In `apps/web/messages/en.json`, add a new `callouts` block inside the `notes` object, immediately BEFORE the `"editorActions"` block:

```json
    "callouts": {
      "label": "Insert callout",
      "note": "Note",
      "tip": "Tip",
      "important": "Important",
      "warning": "Warning",
      "caution": "Caution"
    },
```

In `apps/web/messages/de.json`, add the same block immediately before its `"editorActions"` block:

```json
    "callouts": {
      "label": "Callout einfügen",
      "note": "Hinweis",
      "tip": "Tipp",
      "important": "Wichtig",
      "warning": "Warnung",
      "caution": "Vorsicht"
    },
```

- [ ] **Step 2: Add `CalloutMenu.tsx` to the coverage include list**

In `vitest.config.ts`, after the line added in Task 1 (`'apps/web/src/components/notes/Editor/CalloutExtension.ts',`), add:

```ts
        'apps/web/src/components/notes/Editor/CalloutMenu.tsx',
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/components/notes/Editor/CalloutMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { CalloutMenu } from './CalloutMenu.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    callouts: {
      label: 'Insert callout',
      note: 'Note',
      tip: 'Tip',
      important: 'Important',
      warning: 'Warning',
      caution: 'Caution',
    },
  },
} as const;

/** Editor stub — records the commands `chain().focus().setCallout(t).run()`. */
const makeEditor = () => {
  const commands: string[] = [];
  const chain: Record<string, unknown> = {};
  const proxy = new Proxy(chain, {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        if (prop !== 'focus' && prop !== 'run') {
          commands.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(',')})`);
        }
        return proxy;
      };
    },
  });
  const editor = { chain: () => proxy } as unknown as Editor;
  return { editor, commands };
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('CalloutMenu', () => {
  it('renders a toolbar button and no menu initially', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    expect(within(container).getByLabelText('Insert callout')).toBeTruthy();
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('opens a menu with the five callout types when clicked', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    const menu = within(container).getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(5);
    expect(menu.textContent).toContain('Note');
    expect(menu.textContent).toContain('Caution');
  });

  it('clicking a type runs setCallout with that type and closes the menu', () => {
    const { editor, commands } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    fireEvent.click(within(container).getByRole('menuitem', { name: 'Warning' }));
    expect(commands).toContain('setCallout("warning")');
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('Escape closes the menu', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  it('a click outside closes the menu', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<CalloutMenu editor={editor} />));
    fireEvent.click(within(container).getByLabelText('Insert callout'));
    expect(within(container).queryByRole('menu')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(within(container).queryByRole('menu')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun run test apps/web/src/components/notes/Editor/CalloutMenu.test.tsx`
Expected: FAIL — `./CalloutMenu.tsx` does not exist.

- [ ] **Step 5: Implement `CalloutMenu.tsx`**

Create `apps/web/src/components/notes/Editor/CalloutMenu.tsx`:

```tsx
'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CALLOUT_TYPES, type CalloutType } from './CalloutExtension.ts';

type Props = {
  editor: Editor;
};

/**
 * Toolbar entry that opens a dropdown of the five callout types. Picking one
 * inserts that callout via the `setCallout` command. Owns only its open/closed
 * state; closes on outside-click and Escape.
 */
export function CalloutMenu({ editor }: Props) {
  const t = useTranslations('notes.callouts');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const insert = (type: CalloutType) => {
    editor.chain().focus().setCallout(type).run();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('label')}
        title={t('label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={`hover:bg-muted inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm transition-colors ${
          open ? 'bg-accent text-white' : 'text-foreground'
        }`}
      >
        ▤
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t('label')}
          className="border-paper-line bg-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border p-1 shadow-lg"
        >
          {CALLOUT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(type)}
              className="hover:bg-muted flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm text-foreground"
            >
              <span aria-hidden="true" data-callout={type} className="callout-icon" />
              {t(type)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run test apps/web/src/components/notes/Editor/CalloutMenu.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Mount `CalloutMenu` in the toolbar**

In `apps/web/src/components/notes/Editor/EditorToolbar.tsx`, add the import after the `next-intl` import:

```tsx
import { CalloutMenu } from './CalloutMenu.tsx';
```

In the returned JSX, the toolbar currently ends with the link group:

```tsx
        <Divider />

        <Group>
          <Btn label={t('link')} short="🔗" isActive={isActive('link')} onClick={promptLink} />
        </Group>
      </div>
```

Add a callout group after the link group:

```tsx
        <Divider />

        <Group>
          <Btn label={t('link')} short="🔗" isActive={isActive('link')} onClick={promptLink} />
        </Group>

        <Divider />

        <Group>
          <CalloutMenu editor={editor} />
        </Group>
      </div>
```

(`editor` is already narrowed to non-null here by the `if (!editor) return null;` guard at the top of the component.)

- [ ] **Step 8: Add an `EditorToolbar` test for the callout button**

In `apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`, add a `callouts` block to the test `messages` constant — inside the `notes` object, after the `editorToolbar` block:

```tsx
    callouts: {
      label: 'Insert callout',
      note: 'Note',
      tip: 'Tip',
      important: 'Important',
      warning: 'Warning',
      caution: 'Caution',
    },
```

Then append this test inside the `describe('EditorToolbar', …)` block:

```tsx
  it('renders the callout menu button', () => {
    const { editor } = makeEditor();
    const { container } = render(wrap(<EditorToolbar editor={editor} />));
    expect(within(container).getByLabelText('Insert callout')).toBeTruthy();
  });
```

- [ ] **Step 9: Run the tests + typecheck**

Run: `bun run test apps/web/src/components/notes/Editor/CalloutMenu.test.tsx apps/web/src/components/notes/Editor/EditorToolbar.test.tsx`
Expected: PASS — `CalloutMenu` (5) and `EditorToolbar` (existing + the new callout-button test).

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/notes/Editor/CalloutMenu.tsx apps/web/src/components/notes/Editor/CalloutMenu.test.tsx apps/web/src/components/notes/Editor/EditorToolbar.tsx apps/web/src/components/notes/Editor/EditorToolbar.test.tsx apps/web/messages/en.json apps/web/messages/de.json vitest.config.ts
git commit -m "feat(notes): callout toolbar dropdown"
```

---

## Task 4: Markdown export

Add a Turndown rule so the "Copy as Markdown" button exports callouts as `> [!TYPE]`.

**Files:**
- Modify: `apps/web/src/lib/notes/markdown.ts`
- Test: `apps/web/src/lib/notes/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

Append these tests inside the `describe('htmlToMarkdown', …)` block in `apps/web/src/lib/notes/markdown.test.ts`:

```ts
  it('converts each callout type to a GitHub-style blockquote', () => {
    const cases: Array<[type: string, marker: string]> = [
      ['note', '[!NOTE]'],
      ['tip', '[!TIP]'],
      ['important', '[!IMPORTANT]'],
      ['warning', '[!WARNING]'],
      ['caution', '[!CAUTION]'],
    ];
    for (const [type, marker] of cases) {
      const md = htmlToMarkdown(`<div data-callout="${type}"><p>A Title</p></div>`);
      expect(md).toContain(`> ${marker} A Title`);
    }
  });

  it('prefixes a multi-paragraph callout body with blockquote markers', () => {
    const md = htmlToMarkdown(
      '<div data-callout="note"><p>A Note</p><p>With some content</p></div>',
    );
    expect(md).toContain('> [!NOTE] A Note');
    expect(md).toContain('> With some content');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test apps/web/src/lib/notes/markdown.test.ts`
Expected: FAIL — callouts currently serialize as a plain `<div>` (no `> [!NOTE]`).

- [ ] **Step 3: Add the Turndown rule**

In `apps/web/src/lib/notes/markdown.ts`, the `htmlToMarkdown` function currently registers the `tiptapTaskItem` rule and then returns. Add a second `addRule` call for callouts immediately AFTER the `service.addRule('tiptapTaskItem', { … });` block and BEFORE `return service.turndown(html);`:

```ts
  service.addRule('calloutBlock', {
    filter: (node) => node.nodeName === 'DIV' && node.getAttribute('data-callout') !== null,
    replacement: (content, node) => {
      const type = (node.getAttribute('data-callout') ?? 'note').toUpperCase();
      const lines = content.trim().split('\n');
      const title = (lines[0] ?? '').trim();
      const rest = lines.slice(1).map((line) => (line.trim().length > 0 ? `> ${line}` : '>'));
      return `\n\n${[`> [!${type}] ${title}`.trimEnd(), ...rest].join('\n')}\n\n`;
    },
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test apps/web/src/lib/notes/markdown.test.ts`
Expected: PASS — all tests green, including the two new callout cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/markdown.ts apps/web/src/lib/notes/markdown.test.ts
git commit -m "feat(notes): export callouts as GitHub-style Markdown"
```

---

## Task 5: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Type + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS. Pre-existing ESLint warnings in unrelated files (`NoteEditor.tsx` `_initialTitle`, `save-state.ts` `_exhaustive`) are acceptable; any error is a failure.

- [ ] **Step 2: Full test suite with coverage**

Ensure Postgres + Redis are running (`docker ps`; if not, `make up`). Then run:

Run: `bun run test --coverage`
Expected: PASS — all tests green; coverage thresholds met (statements ≥ 90, branches ≥ 80, functions ≥ 90, lines ≥ 90). The new coverage-gated files — `CalloutExtension.ts`, `CalloutMenu.tsx` — must each stay above threshold.

- [ ] **Step 3: If coverage dips below threshold**

Add targeted tests to `CalloutExtension.test.ts` or `CalloutMenu.test.tsx` for the uncovered lines, re-run Step 2, and commit:

```bash
git add apps/web/src/components/notes/Editor
git commit -m "test(notes): close coverage gap in callout components"
```

If coverage is already fine, skip this step.

- [ ] **Step 4: Next build**

Run: `bun run build`
Expected: the Next build of `apps/web` completes with no error.

- [ ] **Step 5: Working tree check**

Run: `git status --short`
Expected: no uncommitted changes from this plan's files. Pre-existing untracked items (`.vscode/`, `bunfig.toml`, `scripts/`) and a regenerated `apps/web/next-env.d.ts` are unrelated — report but do not commit them.

---

## Self-Review

**Spec coverage:**
- Spec §1 (`callout` node, five types) → Task 1. ✅
- Spec §2 (per-type colour/icon/title styling) → Task 2. ✅
- Spec §3 (toolbar dropdown inserting callouts) → Task 3. ✅
- Spec §4 (Markdown export `> [!TYPE]`) → Task 4. ✅
- Spec §5 (i18n `notes.callouts`) → Task 3 Step 1. ✅
- Spec "Testing" (extension + menu added to coverage `include` and tested; markdown export tested; toolbar button test) → Task 1 Step 1, Task 3 Step 2 + Steps 3/8, Task 4, Task 5. ✅
- Non-goal (no typing/paste parsing) → no input rule or paste rule anywhere. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete content, including the five inline-SVG icons.

**Type consistency:** `CALLOUT_TYPES` / `CalloutType` / `Callout` exported from `CalloutExtension.ts` (Task 1) are imported by `CalloutMenu.tsx` (Task 3) and `MarkdownExtensions.ts` (Task 1). The `setCallout(type: CalloutType)` command declared via module augmentation in Task 1 is called as `editor.chain().focus().setCallout(type).run()` in `CalloutMenu` (Task 3). `CalloutMenu`'s prop `editor: Editor` matches the non-null `editor` passed from `EditorToolbar` after its `if (!editor) return null` guard. The `data-callout` attribute name is consistent across the node's `parseHTML`/`renderHTML` (Task 1), the CSS selectors (Task 2), the dropdown icon span (Task 3), and the Turndown rule's `filter` (Task 4). i18n namespace `notes.callouts` is consistent between the message files (Task 3 Step 1), `CalloutMenu` (`useTranslations('notes.callouts')`), and the `EditorToolbar` test messages (Task 3 Step 8).
