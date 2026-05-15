import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Converts editor HTML to GitHub-flavoured Markdown. Pure and
 * framework-agnostic — it never touches the Tiptap editor instance, so it
 * cannot disturb content parsing, the Collaboration document, or the save
 * path. The GFM plugin adds strikethrough and tables.
 *
 * Tiptap serialises a task item as `<li data-type="taskItem" data-checked="…">`
 * with the checkbox nested inside a `<label>` — a structure the GFM
 * task-list rule does not recognise. The custom rule below maps it to
 * `- [x]` / `- [ ]`, reading the state from `data-checked` and the label
 * from the item's text content (so it is unaffected by however the nested
 * checkbox itself serialises).
 *
 * A fresh TurndownService per call keeps the function stateless.
 */
export const htmlToMarkdown = (html: string): string => {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    emDelimiter: '*',
    codeBlockStyle: 'fenced',
  });
  service.use(gfm);
  service.addRule('tiptapTaskItem', {
    filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
    replacement: (_content, node) => {
      const checked = node.getAttribute('data-checked') === 'true';
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      return `- [${checked ? 'x' : ' '}] ${text}\n`;
    },
  });
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
  return service.turndown(html);
};
