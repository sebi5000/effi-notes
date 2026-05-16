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
});
