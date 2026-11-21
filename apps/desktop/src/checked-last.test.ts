import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { EditorState } from '@tiptap/pm/state';
import { moveTicked } from './checked-last';

const schema = getSchema([StarterKit, TaskList, TaskItem]);
const item = (text: string, checked = false) => schema.node('taskItem', { checked }, [schema.node('paragraph', null, [schema.text(text)])]);
const list = (...items: ReturnType<typeof item>[]) => schema.node('doc', null, [schema.node('taskList', null, items)]);
const texts = (d: ReturnType<typeof list>) => { const out: string[] = []; d.descendants((n) => { if (n.type.name === 'taskItem') out.push(`${n.attrs.checked ? 'x' : ' '}${n.textContent}`); }); return out; };
const tick = (d: ReturnType<typeof list>, index: number) => {
  let at = -1; let i = 0;
  d.descendants((n, pos) => { if (n.type.name === 'taskItem') { if (i === index) at = pos; i += 1; } });
  const state = EditorState.create({ schema, doc: d });
  return state.apply(state.tr.setNodeMarkup(at, undefined, { checked: true }));
};

describe('move checked items to the bottom', () => {
  it('moves the item just ticked to the end of its list', () => {
    const before = list(item('a'), item('b'), item('c'));
    const after = tick(before, 0);
    const tr = moveTicked(before, after);
    expect(texts(after.apply(tr!).doc)).toEqual([' b', ' c', 'xa']);
  });
  it('leaves an item that is already last, or only has checked ones after it', () => {
    const before = list(item('a'), item('b'), item('c', true));
    expect(moveTicked(before, tick(before, 1))).toBeNull();
  });
  it('moves nothing when nothing was ticked', () => {
    const d = list(item('a', true), item('b'));
    expect(moveTicked(d, EditorState.create({ schema, doc: d }))).toBeNull();
  });
});
