import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as PmNode } from '@tiptap/pm/model';

/**
 * Find and replace in a page (Docs and Notes, Ctrl+F and Ctrl+H), as in Pages and Word: every match lit, the current
 * one lit more strongly, Enter for the next. A match stays inside one paragraph, as in both.
 */

export interface Match { from: number; to: number }

/** Every place the words are, in document order. Things in a line that are not text (a picture) count as one character. */
export function findMatches(doc: PmNode, query: string, matchCase: boolean): Match[] {
  if (!query) return [];
  const needle = matchCase ? query : query.toLowerCase();
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const raw = node.textBetween(0, node.content.size, undefined, '￼');
    const text = matchCase ? raw : raw.toLowerCase();
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      out.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
    }
    return false;
  });
  return out;
}

interface FindState { query: string; matchCase: boolean; current: number; matches: Match[]; deco: DecorationSet }
export const findKey = new PluginKey<FindState>('mobius-find');
type FindMeta = Partial<Pick<FindState, 'query' | 'matchCase' | 'current'>>;

const decorate = (doc: PmNode, matches: Match[], current: number) =>
  DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'find-hit find-now' : 'find-hit' })));

const clamp = (current: number, count: number) => (count === 0 ? 0 : Math.min(Math.max(current, 0), count - 1));

export const FindMarks = Extension.create({
  name: 'mobiusFind',
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => ({ query: '', matchCase: false, current: 0, matches: [], deco: DecorationSet.empty }),
        apply(tr: Transaction, old: FindState, _before: EditorState, after: EditorState): FindState {
          const meta = tr.getMeta(findKey) as FindMeta | undefined;
          if (!meta && !tr.docChanged) return old;
          const query = meta?.query ?? old.query;
          const matchCase = meta?.matchCase ?? old.matchCase;
          const matches = findMatches(after.doc, query, matchCase);
          const current = clamp(meta?.current ?? old.current, matches.length);
          return { query, matchCase, current, matches, deco: decorate(after.doc, matches, current) };
        },
      },
      props: { decorations: (state) => findKey.getState(state)?.deco ?? null },
    })];
  },
});

export const findState = (editor: Editor): FindState | undefined => findKey.getState(editor.state);

/** Looks for the words; the current match is the first at or after the cursor, so finding starts where you are. */
export function setFind(editor: Editor, query: string, matchCase: boolean): void {
  const at = editor.state.selection.from;
  const matches = findMatches(editor.state.doc, query, matchCase);
  const next = matches.findIndex((m) => m.from >= at);
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query, matchCase, current: next === -1 ? 0 : next }).setMeta('addToHistory', false));
  reveal(editor);
}

/** Moves to the next match (or the one before), round from the end to the start. */
export function stepFind(editor: Editor, by: number): void {
  const s = findState(editor);
  if (!s || s.matches.length === 0) return;
  const current = (s.current + by + s.matches.length) % s.matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { current }).setMeta('addToHistory', false));
  reveal(editor);
}

/** Puts the current match in view and selects it, so closing the bar leaves the cursor there. */
function reveal(editor: Editor): void {
  const s = findState(editor);
  const m = s?.matches[s.current];
  if (!m) return;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).setMeta('addToHistory', false));
  const { node } = editor.view.domAtPos(m.from);
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
}

/** Replaces the current match and moves to the next; one Undo puts it back. */
export function replaceCurrent(editor: Editor, text: string): void {
  const s = findState(editor);
  const m = s?.matches[s.current];
  if (!m) return;
  editor.view.dispatch(closeHistory(editor.state.tr.insertText(text, m.from, m.to)));
  reveal(editor);
}

/** Replaces every match in one change, so one Undo puts them all back. Returns how many. */
export function replaceAll(editor: Editor, text: string): number {
  const s = findState(editor);
  if (!s || s.matches.length === 0) return 0;
  const tr = editor.state.tr;
  for (const m of [...s.matches].reverse()) tr.insertText(text, m.from, m.to);
  editor.view.dispatch(closeHistory(tr));
  return s.matches.length;
}

/** Clears the highlights. */
export function clearFind(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '' }).setMeta('addToHistory', false));
}
