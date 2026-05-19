'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { CalloutMenu } from './CalloutMenu.tsx';
import { TableMenu } from './TableMenu.tsx';

type Props = {
  editor: Editor | null;
};

/**
 * Floating formatting toolbar pinned to the bottom of the editor area.
 * Mirrors the bar from the spec screenshot: heading levels, lists, common
 * inline marks, blockquote and link.
 *
 * Image / colour-picker are deliberately omitted in v1:
 *   - image uploads need an asset store (out of scope per Phase D)
 *
 * The toolbar is a presentation layer — it owns no state. `editor.isActive`
 * drives the active styling, and chained commands stay focused on the
 * editor so the cursor doesn't jump.
 */
export function EditorToolbar({ editor }: Props) {
  const t = useTranslations('notes.editorToolbar');
  if (!editor) return null;

  const isActive = (name: string, attrs?: Record<string, unknown>): boolean =>
    attrs ? editor.isActive(name, attrs) : editor.isActive(name);

  const promptLink = (): void => {
    const previous = editor.getAttributes('link').href ?? '';
    const url = window.prompt(t('linkPrompt'), previous as string);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="pointer-events-none sticky bottom-6 z-10 mt-6 flex justify-center">
      <div
        role="toolbar"
        aria-label={t('label')}
        className="border-paper-line/80 bg-background/95 pointer-events-auto inline-flex max-w-full flex-wrap items-center justify-center gap-0.5 gap-y-1 rounded-3xl border px-2 py-1 shadow-lg backdrop-blur"
      >
        <Group>
          <Btn
            label={t('h1')}
            short="H1"
            isActive={isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <Btn
            label={t('h2')}
            short="H2"
            isActive={isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <Btn
            label={t('h3')}
            short="H3"
            isActive={isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          />
        </Group>

        <Divider />

        <Group>
          <Btn
            label={t('bold')}
            short="B"
            isActive={isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            classNameExtra="font-semibold"
          />
          <Btn
            label={t('italic')}
            short="I"
            isActive={isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            classNameExtra="italic"
          />
          <Btn
            label={t('strike')}
            short="S"
            isActive={isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            classNameExtra="line-through"
          />
          <Btn
            label={t('code')}
            short="‹›"
            isActive={isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
            classNameExtra="font-mono"
          />
        </Group>

        <Divider />

        <Group>
          <Btn
            label={t('bulletList')}
            short="•"
            isActive={isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <Btn
            label={t('orderedList')}
            short="1."
            isActive={isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <Btn
            label={t('taskList')}
            short="☑"
            isActive={isActive('taskList')}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          />
          <Btn
            label={t('blockquote')}
            short="❝"
            isActive={isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
        </Group>

        <Divider />

        <Group>
          <Btn label={t('link')} short="🔗" isActive={isActive('link')} onClick={promptLink} />
        </Group>

        <Divider />

        <Group>
          <CalloutMenu editor={editor} />
          <TableMenu editor={editor} />
        </Group>
      </div>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <span aria-hidden="true" className="bg-paper-line mx-1 inline-block h-5 w-px" />;
}

function Btn({
  label,
  short,
  isActive,
  onClick,
  classNameExtra,
}: {
  label: string;
  short: string;
  isActive: boolean;
  onClick: () => void;
  classNameExtra?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`hover:bg-muted inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm transition-colors ${
        isActive ? 'bg-accent text-white' : 'text-foreground'
      } ${classNameExtra ?? ''}`}
    >
      {short}
    </button>
  );
}
