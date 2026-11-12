import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addTile, changeTile, changedTiles, moveTile, parseView, removeTile, removedTiles, starterView, tileTitle, writeView, type View } from './views-format';
import { viewReviewText } from './Views';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('views', () => {
  it('reads a view, leaving out tiles it cannot show and options that do not fit', () => {
    const text = JSON.stringify({ version: 1, tiles: [
      { id: 'a', kind: 'tasks', show: 'flagged', size: 'wide' },
      { id: 'b', kind: 'weather' },
      { id: 'a', kind: 'calendar', show: 'flagged' },
      { kind: 'notes', notebook: 'Work', title: '  ' },
      'nonsense',
    ] });
    const parsed = parseView(text);
    expect('view' in parsed && parsed.view.tiles).toEqual([
      { id: 'a', kind: 'tasks', size: 'wide', show: 'flagged' },
      { id: 'a-2', kind: 'calendar', size: 'small' },
      { id: 't4', kind: 'notes', size: 'small', notebook: 'Work' },
    ]);
    expect(parseView('')).toEqual({ view: { version: 1, tiles: [] } });
    expect(parseView('{oops')).toEqual({ error: 'This view’s file is not valid JSON.' });
    expect(parseView('{"version":1}')).toEqual({ error: 'This file has no tiles list.' });
  });

  it('writes one tile per line and reads back the same', () => {
    const view = starterView();
    const text = writeView(view);
    expect(text.split('\n').filter((l) => l.includes('"kind"'))).toHaveLength(view.tiles.length);
    expect(parseView(text)).toEqual({ view });
    expect(writeView({ version: 1, tiles: [] })).toBe('{\n  "version": 1,\n  "tiles": []\n}\n');
  });

  it('a new view from the core starts with the same tiles as Add the usual tiles', () => {
    const rust = fs.readFileSync(path.join(here, '../../../crates/mobius-workspace/src/notes.rs'), 'utf8');
    const literal = /pub fn view_starter[^{]*\{\s*"((?:[^"\\]|\\.)*)"\.to_owned\(\)/.exec(rust)?.[1];
    expect(literal).toBeDefined();
    expect(JSON.parse(`"${literal}"`)).toBe(writeView(starterView()));
  });

  it('adds, changes, moves and removes tiles, keeping the others as they are', () => {
    let view: View = { version: 1, tiles: [] };
    view = addTile(view, 'tasks');
    view = addTile(view, 'mobius');
    view = addTile(view, 'mail');
    expect(view.tiles.map((t) => `${t.id}:${t.kind}:${t.size}`)).toEqual(['t1:tasks:small', 't2:mobius:wide', 't3:mail:small']);
    expect(view.tiles[0]!.show).toBe('today');
    view = moveTile(view, 't3', 0);
    expect(view.tiles.map((t) => t.id)).toEqual(['t3', 't1', 't2']);
    view = moveTile(view, 't3', 99);
    expect(view.tiles.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    view = changeTile(view, 't1', { show: 'flagged', title: 'Hot' });
    expect(tileTitle(view.tiles[0]!)).toBe('Hot');
    view = changeTile(view, 't1', { title: '' });
    expect(view.tiles[0]).toEqual({ id: 't1', kind: 'tasks', size: 'small', show: 'flagged' });
    expect(tileTitle(view.tiles[0]!)).toBe('Tasks · Flagged');
    view = removeTile(view, 't2');
    expect(addTile(view, 'notes').tiles.at(-1)!.id).toBe('t4');
  });

  it('finds what Mobius changed and took away, and says so', () => {
    const before = starterView();
    const after = changeTile(removeTile(addTile(before, 'next'), 't4'), 't2', { show: 'flagged' });
    expect([...changedTiles(before, after)]).toEqual(['t2', 't6']);
    expect(removedTiles(before, after).map((t) => t.id)).toEqual(['t4']);
    expect([...changedTiles(null, after)]).toHaveLength(after.tiles.length);
    expect(viewReviewText(2, 1)).toBe('Mobius changed 2 tiles here, dashed, and took away one.');
    expect(viewReviewText(1, 0)).toBe('Mobius changed one tile here, dashed.');
    expect(viewReviewText(0, 3)).toBe('Mobius took away 3 tiles here.');
  });
});
