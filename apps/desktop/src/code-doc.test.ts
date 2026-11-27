import { describe, expect, it } from 'vitest';
import { History, addCursorV, addNextMatch, colAt, copyLines, deleteBy, deleteLines, docOf, end, home, insertText, invertChanges, applyChanges, moveH, moveLines, moveV, normalize, selectLine, single, visualCol, wordStep, type DocState } from './code-doc';

const at = (text: string, ...heads: number[]): DocState => ({ text, sels: heads.map((h) => ({ anchor: h, head: h })), primary: heads.length - 1 });
const heads = (s: DocState) => s.sels.map((x) => x.head);

describe('code-doc', () => {
  it('joins selections that overlap and keeps the primary one', () => {
    const n = normalize([{ anchor: 5, head: 8 }, { anchor: 0, head: 2 }, { anchor: 7, head: 10 }], 2);
    expect(n.sels).toEqual([{ anchor: 0, head: 2 }, { anchor: 5, head: 10 }]);
    expect(n.primary).toBe(1);
  });

  it('types at every cursor at once, and spreads a pasted line per cursor', () => {
    const s = insertText(at('ab\ncd\nef', 1, 4, 7), 'X').state;
    expect(s.text).toBe('aXb\ncXd\neXf');
    expect(heads(s)).toEqual([2, 6, 10]);
    expect(insertText(at('a\nb', 1, 3), '1\n2').state.text).toBe('a1\nb2');
  });

  it('undoes a run of typing in one step and redoes it', () => {
    const h = new History();
    let s = docOf('hi', 2);
    for (const ch of ' there') { const step = insertText(s, ch); h.record(s, step, 'type', 1000); s = step.state; }
    expect(s.text).toBe('hi there');
    const back = h.undo(s)!;
    expect(back.text).toBe('hi');
    expect(heads(back)).toEqual([2]);
    expect(h.redo(back)!.text).toBe('hi there');
  });

  it('a pause or a move starts a new undo step', () => {
    const h = new History();
    let s = docOf('', 0);
    let step = insertText(s, 'a'); h.record(s, step, 'type', 0); s = step.state;
    step = insertText(s, 'b'); h.record(s, step, 'type', 5000); s = step.state;
    h.seal();
    step = insertText(s, 'c'); h.record(s, step, 'type', 5100); s = step.state;
    expect(h.undo(s)!.text).toBe('ab');
  });

  it('inverts changes exactly', () => {
    const text = 'one two three';
    const changes = [{ from: 0, to: 3, insert: '1' }, { from: 8, to: 13, insert: 'THREE!' }];
    const next = applyChanges(text, changes);
    expect(next).toBe('1 two THREE!');
    expect(applyChanges(next, invertChanges(text, changes))).toBe(text);
  });

  it('deletes a character, a word, a selection and an empty pair', () => {
    expect(deleteBy(at('abc', 2), -1).state.text).toBe('ac');
    expect(deleteBy(at('foo bar', 7), -1, true).state.text).toBe('foo ');
    expect(deleteBy({ text: 'abcd', sels: [{ anchor: 1, head: 3 }], primary: 0 }, -1).state.text).toBe('ad');
    expect(deleteBy(at('f()', 2), -1).state.text).toBe('f');
    expect(deleteBy(at('ab', 0), 1).state.text).toBe('b');
  });

  it('steps by words like Ctrl+Left and Ctrl+Right', () => {
    expect(wordStep('foo.bar baz', 0, 1)).toBe(3);
    expect(wordStep('foo.bar baz', 3, 1)).toBe(4);
    expect(wordStep('foo bar', 7, -1)).toBe(4);
  });

  it('moves up and down keeping the column, and tabs count to their stop', () => {
    const s = at('abcdef\nab\nabcdef', 5);
    const down = moveV(s, 1, false, [null]);
    expect(heads(down.state)).toEqual([9]);
    expect(heads(moveV(down.state, 1, false, down.goals).state)).toEqual([15]);
    expect(visualCol('\tab', 1, 4)).toBe(4);
    expect(colAt('\tab', 4, 4)).toBe(1);
  });

  it('goes home to the first character, then the start of the line', () => {
    const s = home(at('  ab', 4), false);
    expect(heads(s)).toEqual([2]);
    expect(heads(home(s, false))).toEqual([0]);
    expect(heads(end(at('ab\ncd', 0), false))).toEqual([2]);
    expect(moveH({ text: 'abc', sels: [{ anchor: 0, head: 2 }], primary: 0 }, -1, false, false).sels[0]!.head).toBe(0);
  });

  it('Ctrl+D picks the word, then each next place it appears', () => {
    let s = addNextMatch(at('cat dog cat cat', 1));
    expect(s.sels).toEqual([{ anchor: 0, head: 3 }]);
    s = addNextMatch(s);
    s = addNextMatch(s);
    expect(s.sels.map((x) => [x.anchor, x.head])).toEqual([[0, 3], [8, 11], [12, 15]]);
    expect(addNextMatch(s)).toBe(s);
    expect(insertText(s, 'cow').state.text).toBe('cow dog cow cow');
    expect(single(s).sels).toEqual([{ anchor: 12, head: 15 }]);
  });

  it('adds cursors above and below', () => {
    const s = addCursorV(at('abc\nabc\nabc', 1), 1);
    expect(heads(s)).toEqual([1, 5]);
  });

  it('moves, copies and deletes whole lines', () => {
    const moved = moveLines(at('a\nb\nc', 2), -1)!;
    expect(moved.state.text).toBe('b\na\nc');
    expect(heads(moved.state)).toEqual([0]);
    expect(moveLines(at('a\nb', 0), -1)).toBeNull();
    expect(moveLines(at('a\nb\nc', 0), 1)!.state.text).toBe('b\na\nc');
    const copied = copyLines(at('a\nb', 0), 1);
    expect(copied.state.text).toBe('a\na\nb');
    expect(heads(copied.state)).toEqual([2]);
    expect(deleteLines(at('a\nb\nc', 2)).state.text).toBe('a\nc');
    expect(deleteLines(at('a\nb', 2)).state.text).toBe('a');
    expect(selectLine(at('ab\ncd', 1)).sels).toEqual([{ anchor: 0, head: 3 }]);
  });
});

describe('brackets and replacing', () => {
  it('finds a bracket’s partner on either side of the cursor', async () => {
    const { matchBracket } = await import('./code-doc');
    const t = 'f(a[1], (b))';
    expect(matchBracket(t, 1)).toEqual([1, 11]);
    expect(matchBracket(t, 12)).toEqual([1, 11]);
    expect(matchBracket(t, 3)).toEqual([3, 5]);
    expect(matchBracket('(()', 0)).toBeNull();
    expect(matchBracket('abc', 1)).toBeNull();
  });

  it('replaces every match as one step that undo takes back', async () => {
    const { replaceSpans } = await import('./code-doc');
    const h = new History();
    const s = docOf('a b a', 0);
    const step = replaceSpans(s, [[0, 1], [4, 5]], ['x', 'x']);
    h.record(s, step, 'replace');
    expect(step.state.text).toBe('x b x');
    expect(h.undo(step.state)!.text).toBe('a b a');
  });
});

describe('folding', () => {
  const src = ['function a() {', '  if (x) {', '    y()', '', '  }', '  z()', '}', 'done'];
  it('finds regions by indentation, keeping the closing line in view', async () => {
    const { foldRegions } = await import('./code-doc');
    const r = foldRegions(src);
    expect([...r.entries()]).toEqual([[1, 2], [0, 5]]);
  });

  it('hides the lines of folded regions and says which fold hides a line', async () => {
    const { foldRegions, visibleRows, foldsHiding } = await import('./code-doc');
    const r = foldRegions(src);
    const v = visibleRows(src.length, r, new Set([1]));
    expect(v.rows).toEqual([0, 1, 3, 4, 5, 6, 7]);
    expect(v.rowOf[2]).toBe(-1);
    expect(v.rowOf[4]).toBe(3);
    expect(foldsHiding(2, r, new Set([1]))).toEqual([1]);
    expect(visibleRows(src.length, r, new Set([0, 1])).rows).toEqual([0, 6, 7]);
  });

  it('lists the scopes above the top of the view for sticky scroll', async () => {
    const { foldRegions, stickyScopes } = await import('./code-doc');
    expect(stickyScopes(2, foldRegions(src))).toEqual([0, 1]);
    expect(stickyScopes(7, foldRegions(src))).toEqual([]);
  });
});
