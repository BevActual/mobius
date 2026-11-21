import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';

/** "Move checked items to the bottom", as Apple Notes' Sort checked items: off until the person turns it on. */
export const CHECKED_LAST_KEY = 'mobius.notes.checkedLast';
export function checkedLast(): boolean {
  try { return window.localStorage.getItem(CHECKED_LAST_KEY) === '1'; } catch { return false; }
}
export function setCheckedLast(on: boolean): void {
  try { window.localStorage.setItem(CHECKED_LAST_KEY, on ? '1' : '0'); } catch { /* kept off */ }
}

type Item = { node: PMNode; pos: number };
const itemsOf = (doc: PMNode): Item[] => {
  const out: Item[] = [];
  doc.descendants((node, pos) => { if (node.type.name === 'taskItem') out.push({ node, pos }); });
  return out;
};

/**
 * The move a tick makes when the option is on: the item just ticked goes to the end of its own checklist. Only a
 * tick moves anything (the same items before and after, one more of them checked), so opening or editing a page
 * never reorders it.
 */
export function moveTicked(before: PMNode, state: EditorState): Transaction | null {
  const was = itemsOf(before);
  const now = itemsOf(state.doc);
  if (was.length !== now.length) return null;
  const ticked = now.findIndex((it, i) => it.node.attrs.checked === true && was[i]!.node.attrs.checked !== true);
  if (ticked < 0) return null;
  const { node, pos } = now[ticked]!;
  const $pos = state.doc.resolve(pos);
  const list = $pos.parent;
  if (list.type.name !== 'taskList') return null;
  const listStart = $pos.start();
  const listEnd = listStart + list.content.size;
  // Already last, or only checked ones after it: nothing to move.
  let after = false;
  list.forEach((child, offset) => { if (listStart + offset > pos && child.attrs.checked !== true) after = true; });
  if (!after) return null;
  const tr = state.tr;
  tr.delete(pos, pos + node.nodeSize);
  tr.insert(tr.mapping.map(listEnd), node);
  return tr.setMeta('checkedLast', true);
}

export const CheckedLast = Extension.create({
  name: 'checkedLast',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('checked-last'),
      appendTransaction(trs, old, state) {
        if (!checkedLast() || !trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta('checkedLast'))) return null;
        return moveTicked(old.doc, state);
      },
    })];
  },
});
