// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { CALLOUT_TYPES, Callout } from './CalloutExtension.ts';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const make = (content = '<p></p>'): Editor => {
  editor = new Editor({ extensions: [StarterKit, Callout], content });
  return editor;
};

describe('Callout extension', () => {
  it('exposes the five callout types in order', () => {
    expect(CALLOUT_TYPES).toEqual(['note', 'tip', 'important', 'warning', 'caution']);
  });

  it('setCallout inserts a callout node with the given type', () => {
    const e = make();
    e.commands.setCallout('tip');
    expect(e.getHTML()).toContain('data-callout="tip"');
    expect(e.getHTML()).toContain('class="callout"');
  });

  it('setCallout falls back to "note" for an invalid type', () => {
    const e = make();
    // @ts-expect-error — exercising the runtime type guard with a bad value
    e.commands.setCallout('bogus');
    expect(e.getHTML()).toContain('data-callout="note"');
  });

  it('parses an existing data-callout div into a callout node', () => {
    const e = make('<div data-callout="warning"><p>hi</p></div>');
    const node = e.getJSON().content?.[0];
    expect(node?.type).toBe('callout');
    expect(node?.attrs?.type).toBe('warning');
  });

  it('parses an unknown data-callout value as "note"', () => {
    const e = make('<div data-callout="xxx"><p>hi</p></div>');
    expect(e.getJSON().content?.[0]?.attrs?.type).toBe('note');
  });
});
