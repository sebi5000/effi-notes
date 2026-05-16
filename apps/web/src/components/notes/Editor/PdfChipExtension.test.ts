// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfChipNode } from './PdfChipExtension.ts';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const makeEditor = (): Editor => {
  editor = new Editor({ extensions: [StarterKit, PdfChipNode], content: '<p></p>' });
  return editor;
};

/**
 * Editor for HTML-parse assertions. StarterKit's `link` mark also matches
 * `<a>` tags and, being a mark, wins over the `pdfChip` node in ProseMirror's
 * parser. Disabling it isolates the node's own `parseHTML` rules — which is
 * exactly what these cases exercise.
 */
const parseFrom = (content: string): Editor => {
  editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), PdfChipNode],
    content,
  });
  return editor;
};

describe('PdfChipNode', () => {
  it('is registered as an atom block node named pdfChip', () => {
    const e = makeEditor();
    const type = e.schema.nodes.pdfChip;
    expect(type).toBeDefined();
    expect(type?.isAtom).toBe(true);
    expect(type?.isBlock).toBe(true);
  });

  it('round-trips its attributes through insertContent', () => {
    const e = makeEditor();
    e.commands.insertContent({
      type: 'pdfChip',
      attrs: {
        assetId: 'a1',
        src: '/api/assets/a1',
        filename: 'report.pdf',
        byteSize: 2048,
      },
    });
    const json = e.getJSON();
    const node = json.content?.find((n) => n.type === 'pdfChip');
    expect(node?.attrs).toMatchObject({
      assetId: 'a1',
      src: '/api/assets/a1',
      filename: 'report.pdf',
      byteSize: 2048,
    });
  });

  it('renders to an anchor carrying every attribute as data-*', () => {
    const e = makeEditor();
    e.commands.insertContent({
      type: 'pdfChip',
      attrs: {
        assetId: 'a1',
        src: '/api/assets/a1',
        filename: 'report.pdf',
        byteSize: 2048,
      },
    });
    const html = e.getHTML();
    expect(html).toContain('data-pdf-chip');
    expect(html).toContain('data-asset-id="a1"');
    expect(html).toContain('href="/api/assets/a1"');
    expect(html).toContain('data-filename="report.pdf"');
    expect(html).toContain('data-byte-size="2048"');
    expect(html).toContain('>report.pdf</a>');
  });

  it('parses an existing anchor back into a pdfChip node with all attributes', () => {
    const e = parseFrom(
      '<a data-pdf-chip data-asset-id="a1" href="/api/assets/a1" data-filename="report.pdf" data-byte-size="2048">report.pdf</a>',
    );
    const node = e.getJSON().content?.find((n) => n.type === 'pdfChip');
    expect(node?.attrs).toMatchObject({
      assetId: 'a1',
      src: '/api/assets/a1',
      filename: 'report.pdf',
      byteSize: 2048,
    });
  });

  it('falls back to byteSize 0 when data-byte-size is missing or garbage', () => {
    const e = parseFrom(
      '<a data-pdf-chip data-asset-id="a2" href="/api/assets/a2" data-filename="missing.pdf">missing.pdf</a>' +
        '<a data-pdf-chip data-asset-id="a3" href="/api/assets/a3" data-filename="garbage.pdf" data-byte-size="not-a-number">garbage.pdf</a>',
    );
    const chips = e.getJSON().content?.filter((n) => n.type === 'pdfChip') ?? [];
    expect(chips).toHaveLength(2);
    expect(chips[0]?.attrs?.byteSize).toBe(0);
    expect(chips[1]?.attrs?.byteSize).toBe(0);
  });

  it('parses the filename from the anchor text when data-filename is absent', () => {
    const e = parseFrom(
      '<a data-pdf-chip data-asset-id="a5" href="/api/assets/a5" data-byte-size="10">text-content.pdf</a>',
    );
    const node = e.getJSON().content?.find((n) => n.type === 'pdfChip');
    expect(node?.attrs?.filename).toBe('text-content.pdf');
  });

  it('parses src from data-src when href is absent', () => {
    const e = parseFrom(
      '<a data-pdf-chip data-asset-id="a4" data-src="/api/assets/a4" data-filename="from-data-src.pdf" data-byte-size="10">from-data-src.pdf</a>',
    );
    const node = e.getJSON().content?.find((n) => n.type === 'pdfChip');
    expect(node?.attrs?.src).toBe('/api/assets/a4');
  });

  it('omits optional attributes when they are unset or zero', () => {
    const e = makeEditor();
    e.commands.insertContent({
      type: 'pdfChip',
      attrs: { assetId: null, src: null, filename: '', byteSize: 0 },
    });
    const html = e.getHTML();
    expect(html).toContain('data-pdf-chip');
    expect(html).not.toContain('data-asset-id=');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('data-filename=');
    expect(html).toContain('data-byte-size="0"');
  });
});
