'use client';

import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { htmlToMarkdown } from '@/lib/notes/markdown.ts';

type Props = {
  editor: Editor | null;
};

/**
 * Subtle button in the editor's top bar that copies the current note as
 * Markdown. The conversion reads `editor.getHTML()` and runs it through the
 * pure `htmlToMarkdown` helper — it never touches the editor's extensions,
 * the collab document, or the save path. Shows brief "Copied" feedback.
 */
export function CopyMarkdownButton({ editor }: Props) {
  const t = useTranslations('notes.editorActions');
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!editor) return;
    const markdown = htmlToMarkdown(editor.getHTML());
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable / permission denied — leave state unchanged
    }
  }, [editor]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={t('copyMarkdown')}
      title={t('copyMarkdown')}
      className="text-muted-foreground/50 hover:text-foreground inline-flex items-center gap-1 rounded text-xs transition-colors"
    >
      {copied ? (
        <span>
          <span aria-hidden="true">✓ </span>
          <span>{t('copied')}</span>
        </span>
      ) : (
        <span aria-hidden="true" className="text-sm leading-none">
          ⧉
        </span>
      )}
    </button>
  );
}
