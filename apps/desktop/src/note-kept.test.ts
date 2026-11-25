import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';
import { noteImage, ownMarked } from './note-files';
import { KeptLink, keptMarkdown, linkTarget } from './note-kept';

// The editor's own extensions, as NoteEditor has them, reading and writing Markdown.
const extensions = [StarterKit.configure({ link: false }), KeptLink.configure({ openOnClick: false, autolink: true }), TableKit, TaskList, TaskItem.configure({ nested: true }), noteImage(() => 'Work/Plan.md'), ...keptMarkdown];
getSchema(extensions);
const markdown = new MarkdownManager({ marked: ownMarked(), extensions });
const roundTrip = (md: string) => markdown.serialize(markdown.parse(md)).trim();

describe('Markdown from other apps comes back out as it went in', () => {
  it('keeps front matter at the top, and a rule further down is still a rule', () => {
    const md = '---\ntitle: Plan\ntags: [a, b]\n---\n\n# Plan\n\nBody text.\n\n---\n\nAfter rule.';
    expect(roundTrip(md)).toBe(md);
  });
  it('does not take a page that only starts with a rule for front matter', () => {
    expect(markdown.parse('---\n\nAfter a rule.').content?.[0]?.type).toBe('horizontalRule');
  });
  it('keeps footnotes: the marks in the text, a short one to edit and a long one as written', () => {
    const md = '# Notes\n\nA claim.[^1] And another[^note].\n\n[^1]: The source.\n\n[^note]: Second one\n    carried on';
    expect(roundTrip(md)).toBe(md);
    const doc = markdown.parse(md);
    expect(doc.content?.map((n) => n.type)).toEqual(['heading', 'paragraph', 'footnote', 'keptBlock']);
  });
  it('keeps HTML, in a block or in a line, and comments', () => {
    const md = '# Html\n\n<div align="center">Hi</div>\n\nText with <kbd>Ctrl</kbd> inline and <!-- a comment -->.\n\n<details>\n<summary>More</summary>\n\nHidden\n\n</details>';
    expect(roundTrip(md)).toBe(md);
  });
  it('does not take an address in brackets for HTML', () => {
    expect(JSON.stringify(markdown.parse('Mail <a@b.com> or see <https://example.com>.'))).not.toContain('keptInline');
  });
  it('writes a link or picture with a space in angle brackets, and keeps link definitions', () => {
    const md = 'See [the plan](<My Plan.md>) and [rel](My%20Plan.md) and ![pic](<My files/a b.png>).\n\n[unused]: https://unused.example';
    expect(roundTrip(md)).toBe(md);
  });
  it('writes text typed as HTML as text, not as HTML', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a <b> c' }] }] };
    expect(markdown.serialize(doc)).not.toContain('<b>');
  });
});

describe('linkTarget', () => {
  it('leaves an address without spaces as it is, and brackets one with them', () => {
    expect(linkTarget('Plan.md')).toBe('Plan.md');
    expect(linkTarget('My Plan.md')).toBe('<My Plan.md>');
    expect(linkTarget('a (b).md')).toBe('<a (b).md>');
  });
});
