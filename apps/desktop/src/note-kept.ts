import { Extension, Node, type JSONContent } from '@tiptap/core';
import Link from '@tiptap/extension-link';

/**
 * Markdown the editor has no way to show is kept exactly as it was written, so a note written in another app (Obsidian,
 * Bear, a static site, GitHub) comes back out of Mobius the way it went in, whatever is typed around it:
 * - front matter (`---` … `---` at the top of the file);
 * - footnotes: `[^1]` in the text, and `[^1]: …` where they are written;
 * - HTML, as a block (`<details>`) or in a line (`<kbd>Ctrl</kbd>`), and comments (`<!-- … -->`);
 * - link definitions (`[ref]: https://…`), even when nothing uses them;
 * - a link or picture whose address has a space (`[Plan](<My Plan.md>)`), written back in angle brackets.
 * Without these, the editor wrote front matter back as a rule and a heading, put a backslash before every footnote's
 * bracket, turned HTML into escaped text and wrote `[Plan](My Plan.md)`, which no Markdown reader takes as a link.
 * Kept text shows dimmed, as it is in the file; it is changed in the Markdown view.
 */

/** A link's address as Markdown writes it: in angle brackets when it has a space or a bracket that would end it. */
export function linkTarget(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : href;
}

// Its first line is a `key:`, so a page that only starts with a rule is not taken for it.
const FRONT_MATTER = /^---[ \t]*\n[\w-]+[ \t]*:[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
// A footnote's text: its first line, and lines under it indented to carry it on (no blank line between).
const FOOTNOTE = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*)((?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/;
// A tag (`<kbd>`, `</kbd>`, `<br/>`) or a comment. An address in brackets (`<https://…>`, `<a@b.com>`) is not one.
const INLINE_HTML = /^(?:<!--[\s\S]*?-->|<\/?[A-Za-z][\w-]*(?:\s+[^<>]*?)?\s*\/?>)/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\](?!:)/;

const keptBlock = (source: string): JSONContent => ({ type: 'keptBlock', attrs: { source: source.replace(/\s+$/, '') } });

/** Markdown kept as written, on lines of its own: front matter, HTML blocks, link definitions, long footnotes. */
export const KeptBlock = Node.create({
  name: 'keptBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [{ tag: 'pre[data-kept]', getAttrs: (el) => ({ source: (el as HTMLElement).textContent ?? '' }) }],
  renderHTML: ({ node }) => ['pre', { 'data-kept': '', class: 'note-kept', title: 'Kept as written in the file. Change it in the Markdown view.' }, String(node.attrs.source)],
  // HTML and link definitions are marked's own tokens; this reads them, block or inline, before the editor's way does.
  markdownTokenName: 'html',
  parseMarkdown: (token) => {
    const raw = String(token.raw ?? token.text ?? '');
    if (!raw.trim()) return [];
    return token.block ? keptBlock(raw) : { type: 'keptInline', attrs: { source: raw } };
  },
  renderMarkdown: (node) => String(node.attrs?.source ?? ''),
  markdownTokenizer: {
    name: 'keptRaw',
    level: 'block',
    // Front matter only where the file starts (nothing read before it); a footnote wherever a line starts with one.
    start: (src: string) => { const at = src.search(/^\[\^[^\]\s]+\]:/m); return src.startsWith('---') ? 0 : at; },
    tokenize: (src, tokens) => {
      const front = tokens.length === 0 ? FRONT_MATTER.exec(src) : null;
      if (front) return { type: 'keptRaw', raw: front[0], text: front[0] };
      const note = FOOTNOTE.exec(src);
      // A footnote of one line is text to edit; one that carries on under itself is kept as it is.
      if (note && note[3]) return { type: 'keptRaw', raw: note[0], text: note[0] };
      return undefined;
    },
  },
});

/** Link definitions, marked's `def` tokens, become kept blocks. */
export const KeptDefinition = Extension.create({
  name: 'keptDefinition',
  markdownTokenName: 'def',
  parseMarkdown: (token) => keptBlock(String(token.raw ?? '')),
});

/** The kept blocks read above (front matter, long footnotes). Their token has a name of its own, as a handler for a
 * token named like the node would be asked to write the node too. */
export const KeptToken = Extension.create({
  name: 'keptToken',
  markdownTokenName: 'keptRaw',
  parseMarkdown: (token) => keptBlock(String(token.raw ?? '')),
});

/** HTML in a line of text (`<kbd>`, `<br>`, a comment), kept as written. */
export const KeptInline = Node.create({
  name: 'keptInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [{ tag: 'code[data-kept]', getAttrs: (el) => ({ source: (el as HTMLElement).textContent ?? '' }) }],
  renderHTML: ({ node }) => ['code', { 'data-kept': '', class: 'note-kept-inline', title: 'Kept as written in the file. Change it in the Markdown view.' }, String(node.attrs.source)],
  markdownTokenName: 'keptInline',
  parseMarkdown: (token, helpers) => helpers.createNode('keptInline', { source: token.raw }),
  renderMarkdown: (node) => String(node.attrs?.source ?? ''),
  // Read here, before marked: the editor would otherwise make HTML in a line into its own marks or into escaped text.
  markdownTokenizer: {
    name: 'keptInline',
    level: 'inline',
    start: (src: string) => src.search(/<[A-Za-z!/]/),
    tokenize: (src: string) => {
      const m = INLINE_HTML.exec(src);
      return m ? { type: 'keptInline', raw: m[0] } : undefined;
    },
  },
});

/** A footnote's mark in the text, `[^1]`, shown raised. */
export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ label: { default: '' } }),
  parseHTML: () => [{ tag: 'sup[data-footnote]', getAttrs: (el) => ({ label: (el as HTMLElement).dataset.footnote ?? '' }) }],
  renderHTML: ({ node }) => ['sup', { 'data-footnote': String(node.attrs.label), class: 'note-footnote-ref' }, String(node.attrs.label)],
  markdownTokenName: 'footnoteRef',
  parseMarkdown: (token, helpers) => helpers.createNode('footnoteRef', { label: token.label }),
  renderMarkdown: (node) => `[^${String(node.attrs?.label ?? '')}]`,
  markdownTokenizer: {
    name: 'footnoteRef',
    level: 'inline',
    start: (src: string) => src.indexOf('[^'),
    tokenize: (src: string) => {
      const m = FOOTNOTE_REF.exec(src);
      return m ? { type: 'footnoteRef', raw: m[0], label: m[1] } : undefined;
    },
  },
});

/** A footnote of one line, `[^1]: The source.`: its words are edited like any other. */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes: () => ({ label: { default: '' } }),
  parseHTML: () => [{ tag: 'p[data-footnote]', getAttrs: (el) => ({ label: (el as HTMLElement).dataset.footnote ?? '' }) }],
  renderHTML: ({ node }) => ['p', { 'data-footnote': String(node.attrs.label), class: 'note-footnote' }, 0],
  markdownTokenName: 'footnote',
  parseMarkdown: (token, helpers) => helpers.createNode('footnote', { label: token.label }, helpers.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `[^${String(node.attrs?.label ?? '')}]: ${node.content ? h.renderChildren(node.content) : ''}`,
  markdownTokenizer: {
    name: 'footnote',
    level: 'block',
    start: (src: string) => src.search(/^\[\^[^\]\s]+\]:/m),
    tokenize: (src, _tokens, lexer) => {
      const m = FOOTNOTE.exec(src);
      if (!m || m[3]) return undefined;
      return { type: 'footnote', raw: m[0], label: m[1], text: m[2], tokens: lexer.inlineTokens(m[2] ?? '') };
    },
  },
});

/** Links written back with angle brackets round an address that has a space. */
export const KeptLink = Link.extend({
  renderMarkdown: (node, h) => {
    const href = linkTarget(String(node.attrs?.href ?? ''));
    const title = String(node.attrs?.title ?? '');
    const text = h.renderChildren(node);
    return title ? `[${text}](${href} "${title.replace(/"/g, '\\"')}")` : `[${text}](${href})`;
  },
});

/** Everything above, for an editor that reads and writes Markdown files. StarterKit's own link is turned off for it. */
export const keptMarkdown = [KeptBlock, KeptToken, KeptDefinition, KeptInline, FootnoteRef, Footnote];
