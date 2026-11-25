import { Extension, Mark, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep, type Mapping } from '@tiptap/pm/transform';
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model';

/**
 * Suggesting, as Google Docs has it (docs/design/docs.md): in Suggesting mode what the person types is kept as a
 * suggestion rather than a change. Added words carry `suggestAdd`, removed words stay in the page struck through with
 * `suggestDel`, and each is accepted or rejected later. The file stays plain Markdown in the open CriticMarkup notation
 * other Markdown tools read: `{++added++}` and `{--removed--}`.
 */

/** How the page is being written in: as now, as suggestions, or only read. */
export type DocMode = 'editing' | 'suggesting' | 'viewing';
export const DOC_MODES: readonly { id: DocMode; label: string; line: string }[] = [
  { id: 'editing', label: 'Editing', line: 'Change the document' },
  { id: 'suggesting', label: 'Suggesting', line: 'Changes become suggestions to accept or reject' },
  { id: 'viewing', label: 'Viewing', line: 'Read the document without changing it' },
];

const ADD = /^\{\+\+([\s\S]+?)\+\+\}/;
const DEL = /^\{--([\s\S]+?)--\}/;

/** Added words in Suggesting mode: `{++words++}`. */
export const SuggestAdd = Mark.create({
  name: 'suggestAdd',
  inclusive: true,
  excludes: 'suggestDel',
  parseHTML: () => [{ tag: 'ins[data-suggest]' }],
  renderHTML: () => ['ins', { 'data-suggest': '', class: 'doc-suggest-add', title: 'Suggested. Right-click to accept or reject it.' }, 0],
  markdownTokenName: 'suggestAdd',
  parseMarkdown: (token, helpers) => helpers.applyMark('suggestAdd', helpers.parseInline(token.tokens ?? [])),
  renderMarkdown: (node, h) => `{++${h.renderChildren(node)}++}`,
  markdownTokenizer: {
    name: 'suggestAdd',
    level: 'inline',
    start: (src: string) => src.indexOf('{++'),
    tokenize: (src, _tokens, lexer) => {
      const m = ADD.exec(src);
      return m ? { type: 'suggestAdd', raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]!) } : undefined;
    },
  },
});

/** Removed words in Suggesting mode, still in the page: `{--words--}`. */
export const SuggestDel = Mark.create({
  name: 'suggestDel',
  inclusive: false,
  excludes: 'suggestAdd',
  parseHTML: () => [{ tag: 'del[data-suggest]' }],
  renderHTML: () => ['del', { 'data-suggest': '', class: 'doc-suggest-del', title: 'Suggested for removal. Right-click to accept or reject it.' }, 0],
  markdownTokenName: 'suggestDel',
  parseMarkdown: (token, helpers) => helpers.applyMark('suggestDel', helpers.parseInline(token.tokens ?? [])),
  renderMarkdown: (node, h) => `{--${h.renderChildren(node)}--}`,
  markdownTokenizer: {
    name: 'suggestDel',
    level: 'inline',
    start: (src: string) => src.indexOf('{--'),
    tokenize: (src, _tokens, lexer) => {
      const m = DEL.exec(src);
      return m ? { type: 'suggestDel', raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]!) } : undefined;
    },
  },
});

const key = new PluginKey('docSuggest');
/** Set on the transactions this plugin makes, and on loads, so they are never made into suggestions again. */
export const SUGGEST_SKIP = 'mobius-suggest-skip';

/** Whether a transaction is the person's own edit, made in the page (not a load, an undo or this plugin's own). */
function personal(t: Transaction): boolean {
  if (!t.docChanged || t.getMeta(SUGGEST_SKIP) || t.getMeta('mobius-load') || t.getMeta('addToHistory') === false) return false;
  // Undo and redo carry the history plugin's meta.
  return !Object.keys((t as unknown as { meta: Record<string, unknown> }).meta ?? {}).some((k) => k.startsWith('history$'));
}

/** Whether every piece of text in a slice of the old page carries the mark. */
function allMarked(doc: PMNode, from: number, to: number, mark: string): boolean {
  let every = true;
  let any = false;
  doc.nodesBetween(from, to, (n) => {
    if (!n.isText) return true;
    any = true;
    if (!n.marks.some((m) => m.type.name === mark)) every = false;
    return false;
  });
  return any && every;
}

/**
 * Turns the person's edits into suggestions while `active()` says so. Typing is marked as added; what is deleted
 * inside one paragraph is put back, struck through. Deleting words that were themselves a suggested addition takes them
 * out for good, as it does in Google Docs. A deletion across paragraphs is made as it is (later: kept as a suggestion).
 */
export function suggesting(active: () => boolean) {
  return Extension.create({
    name: 'docSuggesting',
    addProseMirrorPlugins: () => [
      new Plugin({
        key,
        appendTransaction: (trs: readonly Transaction[], oldState: EditorState, state: EditorState) => {
          if (!active() || trs.length !== 1 || !personal(trs[0]!)) return null;
          const t = trs[0]!;
          const add = state.schema.marks.suggestAdd;
          const del = state.schema.marks.suggestDel;
          if (!add || !del) return null;
          const out = state.tr.setMeta(SUGGEST_SKIP, true);
          let caret: number | null = null;
          t.steps.forEach((step, i) => {
            if (!(step instanceof ReplaceStep)) return;
            const { from, to, slice } = step as unknown as { from: number; to: number; slice: { size: number } };
            const before = t.docs[i]!;
            const rest = t.mapping.slice(i + 1) as Mapping;
            const at = out.mapping.map(rest.map(from, -1), -1);
            // What was typed is an added suggestion.
            if (slice.size > 0) {
              const end = out.mapping.map(rest.map(from + slice.size, 1), 1);
              out.removeMark(at, end, del);
              out.addMark(at, end, add.create());
            }
            if (to <= from) return;
            const $from = before.resolve(from);
            const $to = before.resolve(to);
            // Taking out one's own suggested words takes them out; across paragraphs, the deletion stands for now.
            if (!$from.sameParent($to) || !$from.parent.isTextblock || allMarked(before, from, to, 'suggestAdd')) return;
            const gone = before.slice(from, to);
            const struck: PMNode[] = [];
            gone.content.forEach((n) => {
              if (!n.isText) { struck.push(n); return; }
              // Words that were a suggested addition go for good; the rest come back struck through.
              if (n.marks.some((m) => m.type === add)) return;
              struck.push(n.mark(del.create().addToSet(n.marks.filter((m: PMMark) => m.type !== del))));
            });
            if (!struck.length) return;
            out.insert(at, struck);
            const size = struck.reduce((s, n) => s + n.nodeSize, 0);
            // The caret stays where the deletion began, before the struck words, so Backspace carries on leftwards; a
            // forward delete (the caret was at its start) steps over them.
            if (slice.size === 0) caret = oldState.selection.empty && oldState.selection.from === from ? at + size : at;
          });
          if (!out.docChanged) return null;
          if (caret !== null) out.setSelection(TextSelection.create(out.doc, caret));
          return out;
        },
      }),
    ],
  });
}

/** One suggestion: the run of text carrying one of the two marks, around a position. */
export function suggestionAt(state: EditorState, pos: number): { kind: 'add' | 'del'; from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const start = $pos.start();
  const kindOf = (n: PMNode | null | undefined): 'add' | 'del' | null => (n?.marks.some((m) => m.type.name === 'suggestAdd') ? 'add' : n?.marks.some((m) => m.type.name === 'suggestDel') ? 'del' : null);
  const kind = kindOf($pos.nodeAfter) ?? kindOf($pos.nodeBefore);
  if (!kind) return null;
  // The children of the paragraph, with where each starts, to find the run the position is in.
  const runs: { from: number; to: number; kind: 'add' | 'del' | null }[] = [];
  parent.forEach((n, offset) => runs.push({ from: start + offset, to: start + offset + n.nodeSize, kind: kindOf(n) }));
  let i = runs.findIndex((r) => r.kind === kind && r.from <= pos && pos <= r.to);
  if (i < 0) return null;
  let a = i;
  while (a > 0 && runs[a - 1]!.kind === kind && runs[a - 1]!.to === runs[a]!.from) a -= 1;
  while (i < runs.length - 1 && runs[i + 1]!.kind === kind && runs[i + 1]!.from === runs[i]!.to) i += 1;
  return { kind, from: runs[a]!.from, to: runs[i]!.to };
}

/** Every suggestion in the page, last first, so settling one leaves the positions of those before it. */
function allSuggestions(doc: PMNode): { kind: 'add' | 'del'; from: number; to: number }[] {
  const found: { kind: 'add' | 'del'; from: number; to: number }[] = [];
  doc.descendants((n, pos) => {
    if (!n.isText) return true;
    const kind = n.marks.some((m) => m.type.name === 'suggestAdd') ? 'add' : n.marks.some((m) => m.type.name === 'suggestDel') ? 'del' : null;
    if (!kind) return false;
    const last = found[found.length - 1];
    if (last && last.kind === kind && last.to === pos) last.to = pos + n.nodeSize;
    else found.push({ kind, from: pos, to: pos + n.nodeSize });
    return false;
  });
  return found.reverse();
}

/** Accepts or rejects one suggestion: an accepted addition stays and a rejected one goes; a removal the other way. */
function settle(tr: Transaction, s: { kind: 'add' | 'del'; from: number; to: number }, accept: boolean): void {
  const mark = tr.doc.type.schema.marks[s.kind === 'add' ? 'suggestAdd' : 'suggestDel']!;
  if ((s.kind === 'add') === accept) tr.removeMark(s.from, s.to, mark);
  else tr.delete(s.from, s.to);
}

/** Accepts or rejects the suggestion at the caret (or `pos`); false when there is none there. */
export function settleSuggestion(editor: Editor, accept: boolean, pos = editor.state.selection.from): boolean {
  const s = suggestionAt(editor.state, pos);
  if (!s) return false;
  const tr = editor.state.tr.setMeta(SUGGEST_SKIP, true);
  settle(tr, s, accept);
  editor.view.dispatch(tr);
  return true;
}

/** Accepts or rejects every suggestion in the page, in one step to undo. */
export function settleAll(editor: Editor, accept: boolean): number {
  const all = allSuggestions(editor.state.doc);
  if (!all.length) return 0;
  const tr = editor.state.tr.setMeta(SUGGEST_SKIP, true);
  for (const s of all) settle(tr, s, accept);
  editor.view.dispatch(tr);
  return all.length;
}

/** How many suggestions the page holds. */
export function countSuggestions(doc: PMNode): number {
  return allSuggestions(doc).length;
}
