// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { NoteImage } from '../../components/notes/Editor/ImageExtension.ts';
import { PdfChipNode } from '../../components/notes/Editor/PdfChipExtension.ts';
import { deriveDocItems, isInternalNoteLink } from './doc-outline.ts';

const ORIGIN = 'http://localhost:3000';

const makeDoc = () => {
  const editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Intro' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Details' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'see note',
              marks: [{ type: 'link', attrs: { href: '/notes/abc123' } }],
            },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'the web',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/page' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: '/api/assets/img1', caption: 'A diagram' } },
        {
          type: 'pdfChip',
          attrs: {
            assetId: 'pdf1',
            src: '/api/assets/pdf1',
            filename: 'report.pdf',
            byteSize: 2048,
          },
        },
      ],
    },
  });
  return editor.state.doc;
};

/** Build a doc from a single paragraph's inline content. */
const makeParagraphDoc = (content: JSONContent[]) => {
  const editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
    content: { type: 'doc', content: [{ type: 'paragraph', content }] },
  });
  return editor.state.doc;
};

describe('isInternalNoteLink', () => {
  it('treats a /notes/<id> path on the app origin as internal', () => {
    expect(isInternalNoteLink('/notes/abc', ORIGIN)).toBe(true);
    expect(isInternalNoteLink(`${ORIGIN}/notes/abc`, ORIGIN)).toBe(true);
  });
  it('treats other app pages and external URLs as external', () => {
    expect(isInternalNoteLink('/dashboard', ORIGIN)).toBe(false);
    expect(isInternalNoteLink('https://example.com/notes/abc', ORIGIN)).toBe(false);
    expect(isInternalNoteLink('not a url', ORIGIN)).toBe(false);
  });
  it('returns false when the origin is not a valid URL base', () => {
    expect(isInternalNoteLink('/notes/x', 'not a valid base')).toBe(false);
  });
});

describe('deriveDocItems', () => {
  it('derives headings with level, text, and position', () => {
    const { headings } = deriveDocItems(makeDoc(), ORIGIN);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Intro'],
      [2, 'Details'],
    ]);
    expect(headings[0]?.pos).toBeTypeOf('number');
  });

  it('derives image items', () => {
    const { images } = deriveDocItems(makeDoc(), ORIGIN);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ kind: 'image', src: '/api/assets/img1', label: 'A diagram' });
  });

  it('derives PDF items with the preview URL', () => {
    const { pdfs } = deriveDocItems(makeDoc(), ORIGIN);
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0]).toMatchObject({
      kind: 'pdf',
      label: 'report.pdf',
      previewSrc: '/api/assets/pdf1/preview',
    });
  });

  it('derives links and classifies internal vs external', () => {
    const { links } = deriveDocItems(makeDoc(), ORIGIN);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ href: '/notes/abc123', text: 'see note', internal: true });
    expect(links[1]).toMatchObject({ href: 'https://example.com/page', internal: false });
  });

  it('merges consecutive text nodes carrying the same link href into one link', () => {
    const doc = makeParagraphDoc([
      { type: 'text', text: 'plain ', marks: [{ type: 'link', attrs: { href: '/notes/merge' } }] },
      {
        type: 'text',
        text: 'bold',
        marks: [{ type: 'link', attrs: { href: '/notes/merge' } }, { type: 'bold' }],
      },
      { type: 'text', text: ' end', marks: [{ type: 'link', attrs: { href: '/notes/merge' } }] },
    ]);
    const { links } = deriveDocItems(doc, ORIGIN);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      href: '/notes/merge',
      text: 'plain bold end',
      internal: true,
    });
  });

  it('keeps adjacent link text nodes with different hrefs as separate links', () => {
    const doc = makeParagraphDoc([
      { type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: '/notes/aaa' } }] },
      { type: 'text', text: 'b', marks: [{ type: 'link', attrs: { href: '/notes/bbb' } }] },
    ]);
    const { links } = deriveDocItems(doc, ORIGIN);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.href)).toEqual(['/notes/aaa', '/notes/bbb']);
  });

  it('yields an empty previewSrc for a PDF chip without an assetId', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), Link, NoteImage, PdfChipNode],
      content: {
        type: 'doc',
        content: [{ type: 'pdfChip', attrs: { src: '/api/assets/x', filename: 'x.pdf' } }],
      },
    });
    const { pdfs } = deriveDocItems(editor.state.doc, ORIGIN);
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0]).toMatchObject({ kind: 'pdf', label: 'x.pdf', previewSrc: '' });
  });
});
