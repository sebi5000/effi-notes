// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteImage } from './ImageExtension.ts';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const make = (content = '<p></p>'): Editor => {
  editor = new Editor({ extensions: [StarterKit, NoteImage], content });
  return editor;
};

describe('NoteImage extension', () => {
  it('renders an image with src, width and caption attributes', () => {
    const e = make();
    e.commands.insertContent({
      type: 'image',
      attrs: { src: '/api/assets/a1', width: 240, caption: 'A photo' },
    });
    const html = e.getHTML();
    expect(html).toContain('src="/api/assets/a1"');
    expect(html).toContain('width="240"');
    expect(html).toContain('A photo');
  });

  it('parses an existing <img> with data-width / data-caption back to attributes', () => {
    const e = make('<img src="/api/assets/a2" data-width="180" data-caption="Cat">');
    const node = e.getJSON().content?.[0];
    expect(node?.type).toBe('image');
    expect(node?.attrs?.src).toBe('/api/assets/a2');
    expect(node?.attrs?.width).toBe(180);
    expect(node?.attrs?.caption).toBe('Cat');
  });

  it('parses an <img> with no width or caption to null width and empty caption', () => {
    const e = make('<img src="/api/assets/a3">');
    const node = e.getJSON().content?.[0];
    expect(node?.attrs?.width).toBeNull();
    expect(node?.attrs?.caption).toBe('');
  });

  it('omits the width and data-caption attributes when they are unset', () => {
    const e = make();
    e.commands.insertContent({ type: 'image', attrs: { src: '/api/assets/a4' } });
    const html = e.getHTML();
    expect(html).not.toContain('width=');
    expect(html).not.toContain('data-caption=');
  });
});
