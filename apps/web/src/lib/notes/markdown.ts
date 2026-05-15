import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Converts editor HTML to GitHub-flavoured Markdown. Pure and
 * framework-agnostic — it never touches the Tiptap editor instance, so it
 * cannot disturb content parsing, the Collaboration document, or the save
 * path. The GFM plugin adds task lists, strikethrough, and tables.
 *
 * A fresh TurndownService per call keeps the function stateless.
 */
export const htmlToMarkdown = (html: string): string => {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  service.use(gfm);
  return service.turndown(html);
};
