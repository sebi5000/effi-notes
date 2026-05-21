// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { AppointmentLinkNodeBase } from './appointment-link-node.ts';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const make = (content = '<p></p>'): Editor => {
  editor = new Editor({ extensions: [StarterKit, AppointmentLinkNodeBase], content });
  return editor;
};

describe('appointment-link node', () => {
  it('round-trips appointmentId + subject through HTML', () => {
    const e = make(
      '<p>Discussed in <span data-appointment-id="evt-1" data-subject="Q4 Review">📅 Q4 Review</span>.</p>',
    );
    const html = e.getHTML();
    expect(html).toContain('data-appointment-id="evt-1"');
    expect(html).toContain('data-subject="Q4 Review"');
    // Snapshot text used by the public renderer (no React) — keeps the
    // doc readable even when the chip's NodeView isn't mounted.
    expect(html).toContain('📅 Q4 Review');
  });

  // The Tiptap JSON tree's `content` is loosely typed (union of node /
  // text). For these schema-level assertions we just need the attr bag —
  // re-cast through a permissive shape so TypeScript doesn't fight us.
  type LooseNode = { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };

  it('parses a chip without the leading 📅 prefix from text content', () => {
    const e = make('<p><span data-appointment-id="evt-2">Standup</span></p>');
    const inner = (e.getJSON().content?.[0] as LooseNode | undefined)?.content?.[0] as
      | LooseNode
      | undefined;
    expect(inner?.type).toBe('appointmentLink');
    expect(inner?.attrs?.appointmentId).toBe('evt-2');
    expect(inner?.attrs?.subject).toBe('Standup');
  });

  it('is an inline atom (cannot contain editable content)', () => {
    const e = make('<p><span data-appointment-id="x" data-subject="X">📅 X</span></p>');
    const inner = (e.getJSON().content?.[0] as LooseNode | undefined)?.content?.[0] as
      | LooseNode
      | undefined;
    expect(inner?.content).toBeUndefined();
  });

  it('strips a chip whose appointmentId is empty (renderHTML omits data-attr)', () => {
    const e = make('<p>Hi</p>');
    e.commands.insertContent({
      type: 'appointmentLink',
      attrs: { appointmentId: '', subject: 'no-id' },
    });
    // appointmentId missing → renderHTML omits the data-attr, so a re-parse
    // wouldn't reconstruct the node. The text body still carries the
    // subject so the doc reads coherently.
    const html = e.getHTML();
    expect(html).toContain('📅 no-id');
    expect(html).not.toContain('data-appointment-id="');
  });
});
