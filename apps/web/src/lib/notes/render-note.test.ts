// @vitest-environment jsdom
import { Editor, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { buildRenderExtensions } from '@/components/notes/Editor/render-extensions.ts';
import { renderNoteHtml } from './render-note.ts';

/**
 * Build a realistic `yjsState` snapshot from HTML: parse it with a headless
 * editor to ProseMirror JSON, then convert that into a Y.Doc's `default`
 * XML fragment (the field name the Collaboration extension uses) exactly as a
 * persisted note snapshot would carry it.
 */
const yjsStateFrom = (html: string): Uint8Array => {
  const editor = new Editor({ extensions: buildRenderExtensions(), content: html });
  const json = editor.getJSON();
  editor.destroy();
  const schema = getSchema(buildRenderExtensions());
  const ydoc = prosemirrorJSONToYDoc(schema, json, 'default');
  return Y.encodeStateAsUpdate(ydoc);
};

describe('renderNoteHtml', () => {
  it('renders formatted note content from a Yjs snapshot', () => {
    const html = renderNoteHtml(
      yjsStateFrom('<h1>Title</h1><p>Hello <strong>world</strong></p>'),
      '',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>world</strong>');
  });

  it('falls back to escaped plain text when there is no Yjs state', () => {
    const html = renderNoteHtml(null, 'plain <body> text');
    expect(html).toContain('plain &lt;body&gt; text');
    expect(html).not.toContain('<body>');
  });

  it('strips a javascript: link href', () => {
    const html = renderNoteHtml(yjsStateFrom('<p><a href="javascript:alert(1)">x</a></p>'), '');
    expect(html).not.toContain('javascript:');
  });

  it('rewrites image asset URLs via the supplied rewriter', () => {
    const html = renderNoteHtml(yjsStateFrom('<img src="/api/notes/n1/assets/a1">'), '', {
      rewriteAssetUrl: (src) => src.replace('/api/notes/n1/assets/', '/p/tok/assets/'),
    });
    expect(html).toContain('/p/tok/assets/a1');
    expect(html).not.toContain('/api/notes/n1/assets/');
  });
});
