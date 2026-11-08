import { describe, expect, it } from 'vitest';
import { tidyItems, pasteItems, arrowEnds, boardBounds, boardOutline, changedItems, edgePoint, freshItemId, itemsIn, moveItem, parseBoard, placeNew, removeItems, removedItems, thinPoints, writeBoard, type Board } from './board-format';

const SAMPLE = {
  version: 1,
  items: [
    { id: 's1', type: 'sticky', x: 0, y: 0, w: 180, h: 180, color: 'yellow', text: 'Walkable' },
    { id: 'b1', type: 'shape', shape: 'diamond', x: 400, y: 0, w: 200, h: 180, color: 'blue', text: 'Under $6k?' },
    { id: 'a1', type: 'arrow', from: 's1', to: 'b1' },
    { id: 'a2', type: 'arrow', from: 's1', to: 'gone' },
    { id: 'i1', type: 'ink', points: [[0, 300], [50, 320]] },
    { id: 't1', type: 'text', x: 0, y: -80, w: 300, h: 40, text: 'Offsite', size: 28 },
  ],
};
const board = (): Board => { const p = parseBoard(JSON.stringify(SAMPLE)); if ('error' in p) throw new Error(p.error); return p.board; };

describe('boards', () => {
  it('reads a board, filling defaults and leaving out arrows to nothing', () => {
    const b = board();
    expect(b.items.map((x) => x.id)).toEqual(['s1', 'b1', 'a1', 'i1', 't1']);
    expect(b.items[3]).toEqual({ id: 'i1', type: 'ink', color: 'ink', points: [[0, 300], [50, 320]] });
    const loose = parseBoard('{"items":[{"text":"hi"},{"type":"shape","color":"magenta"},{"type":"nope"}]}');
    expect('board' in loose && loose.board.items).toEqual([
      { id: 'i1', type: 'sticky', x: 0, y: 0, w: 180, h: 180, color: 'yellow', text: 'hi' },
      { id: 'i2', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 120, color: 'white', text: '' },
    ]);
    expect(parseBoard('{not json')).toHaveProperty('error');
  });

  it('writes one item per line and reads back the same', () => {
    const b = board();
    const text = writeBoard(b);
    expect(text.split('\n').filter((l) => l.includes('"id"')).length).toBe(5);
    expect(parseBoard(text)).toEqual({ board: b });
    expect(writeBoard({ version: 1, items: [] })).toBe('{\n  "version": 1,\n  "items": []\n}\n');
  });

  it('puts arrow ends on the edges of what they join', () => {
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: -100 }, 'ellipse')).toEqual({ x: 50, y: 0 });
    const ends = arrowEnds(board(), board().items[2] as never)!;
    expect(ends).toEqual({ x1: 180, y1: 90, x2: 400, y2: 90 });
  });

  it('marks what changed and what went', () => {
    const before = board();
    const after = board();
    moveItem(after.items[0]!, 10, 0);
    removeItems(after, new Set(['b1']));
    expect([...changedItems(before, after)]).toEqual(['s1']);
    expect(removedItems(before, after)).toEqual(['b1', 'a1']);
    expect([...changedItems(null, after)].length).toBe(after.items.length);
  });

  it('finds room, ids, bounds and what a drag covers', () => {
    const b = board();
    expect(freshItemId(b, 'sticky')).toBe('s2');
    expect(placeNew(b, { x: 90, y: 90 }, { w: 180, h: 180 })).toEqual({ x: 24, y: 24 });
    expect(boardBounds(b)).toEqual({ x: 0, y: -80, w: 600, h: 400 });
    expect(itemsIn(b, { x: -10, y: -10, w: 50, h: 50 })).toEqual(['s1']);
    expect(thinPoints([[0, 0], [1, 1], [5, 0], [6, 0]])).toEqual([[0, 0], [5, 0], [6, 0]]);
  });

  it('pastes copies with new ids, and arrows between them', () => {
    const b = board();
    const made = pasteItems(b, b.items.filter((x) => ['s1', 'b1', 'a1', 't1'].includes(x.id)), 24, 24);
    expect(made).toEqual(['s2', 'b2', 't2', 'a2']);
    expect(b.items.find((x) => x.id === 'a2')).toEqual({ id: 'a2', type: 'arrow', from: 's2', to: 'b2', text: '' });
    expect(b.items.find((x) => x.id === 's2')).toMatchObject({ x: 24, y: 24, text: 'Walkable' });
    // An arrow whose other end was not copied stays behind.
    expect(pasteItems(b, b.items.filter((x) => x.id === 'a1' || x.id === 's1'), 0, 0)).toEqual(['s3']);
  });

  it('tidies items into a grid in reading order', () => {
    const b: Board = { version: 1, items: [
      { id: 'c', type: 'sticky', x: 500, y: 300, w: 100, h: 100, color: 'yellow', text: '' },
      { id: 'a', type: 'sticky', x: 40, y: 10, w: 100, h: 100, color: 'yellow', text: '' },
      { id: 'b', type: 'sticky', x: 300, y: 30, w: 100, h: 100, color: 'yellow', text: '' },
    ] };
    tidyItems(b, new Set(['a', 'b', 'c']));
    expect(b.items.map((i) => ('x' in i ? [i.id, i.x, i.y] : []))).toEqual([['c', 40, 134], ['a', 40, 10], ['b', 164, 10]]);
  });

  it('reads as an outline', () => {
    expect(boardOutline(board())).toBe('- [yellow sticky] Walkable\n- [diamond] Under $6k?\n- Walkable → Under $6k?\n# Offsite');
  });
});
