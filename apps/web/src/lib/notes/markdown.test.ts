// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './markdown.ts';

describe('htmlToMarkdown', () => {
  it('converts headings with ATX syntax', () => {
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
    expect(htmlToMarkdown('<h2>Sub</h2>')).toBe('## Sub');
  });

  it('converts bold and italic', () => {
    expect(htmlToMarkdown('<p><strong>bold</strong> and <em>italic</em></p>')).toBe(
      '**bold** and *italic*',
    );
  });

  it('converts bullet lists with a dash marker', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('-   one\n-   two');
  });

  it('converts ordered lists', () => {
    expect(htmlToMarkdown('<ol><li>first</li><li>second</li></ol>')).toBe('1.  first\n2.  second');
  });

  it('converts links', () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">site</a></p>')).toBe(
      '[site](https://example.com)',
    );
  });

  it('converts inline code', () => {
    expect(htmlToMarkdown('<p>run <code>bun test</code></p>')).toBe('run `bun test`');
  });

  it('converts GFM task lists to checkbox syntax', () => {
    const html =
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>done</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>todo</p></div></li>' +
      '</ul>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('- [x] done');
    expect(md).toContain('- [ ] todo');
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
  });
});
