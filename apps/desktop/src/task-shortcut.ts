import { Extension, InputRule } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

/** Splits `tr` at `pos` (depth 1) and gives where `cur` is after. */
const splitAt = (tr: Transaction, pos: number, cur: number): number => {
  const from = tr.mapping.maps.length;
  tr.split(pos, 1);
  return tr.mapping.slice(from).map(cur);
};

/**
 * "- [ ] " (or "* [x] ") typed at the start of a bullet makes it a checklist item, as it does in Notion, Bear and
 * Obsidian. A plain line already does this ("[ ] "); inside a bullet the checklist's own rule can't wrap, so that one
 * bullet becomes a checklist of its own and the bullets around it stay bullets.
 */
export const BulletToTask = Extension.create({
  name: 'bulletToTask',
  addInputRules() {
    return [new InputRule({
      find: /^\s*\[([ xX])?\]\s$/,
      handler: ({ state, range, match }) => {
        const { schema, tr } = state;
        const $at = state.doc.resolve(range.from);
        if ($at.depth < 3 || $at.node(-1).type.name !== 'listItem' || $at.node(-2).type.name !== 'bulletList' || !schema.nodes.taskList || !schema.nodes.taskItem) return null;
        tr.delete(range.from, range.to);
        let cur = tr.mapping.map(range.from);
        let $c = tr.doc.resolve(cur);
        if ($c.after(-1) < $c.end(-2)) cur = splitAt(tr, $c.after(-1), cur);
        $c = tr.doc.resolve(cur);
        if ($c.before(-1) > $c.start(-2)) cur = splitAt(tr, $c.before(-1), cur);
        $c = tr.doc.resolve(cur);
        const offset = cur - $c.before(-2);
        const item = schema.nodes.taskItem.create({ checked: /x/i.test(match[1] ?? '') }, $c.node(-1).content);
        const start = $c.before(-2);
        tr.replaceWith(start, $c.after(-2), schema.nodes.taskList.create(null, item));
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start + offset, tr.doc.content.size))));
      },
    })];
  },
});
