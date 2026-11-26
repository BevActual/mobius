import { describe, expect, it } from 'vitest';
import { BLANKS, filterChoices, hiddenRows, nextShownRow, replaceIn } from './sheets-view';

const rows = [['Name', 'Team', 'Points'], ['Ana', 'Red', '12'], ['Bo', 'Blue', '9'], ['Cy', '', '100'], ['Di', 'red', '12'], ['Total', '', '133']];

describe('filter on the header row, as Excel', () => {
  it('lists each value once, numbers by size and blanks last', () => {
    expect(filterChoices(rows, 1, 1, 4)).toEqual(['Blue', 'Red', 'red', BLANKS]);
    expect(filterChoices(rows, 2, 1, 4)).toEqual(['9', '12', '100']);
  });
  it('hides the rows showing a hidden value, never the header or the total', () => {
    expect([...hiddenRows(rows, { 1: ['Red', BLANKS] }, 1, 4)]).toEqual([1, 3]);
    expect([...hiddenRows(rows, { 1: ['Blue'], 2: ['12'] }, 1, 4)]).toEqual([1, 2, 4]);
    expect(hiddenRows(rows, { 1: [] }, 1, 4).size).toBe(0);
  });
  it('moves past hidden rows', () => {
    const hidden = new Set([2, 3]);
    expect(nextShownRow(1, 1, hidden, 10)).toBe(4);
    expect(nextShownRow(4, -1, hidden, 10)).toBe(1);
    expect(nextShownRow(0, -1, hidden, 10)).toBe(0);
  });
});

describe('replace, as Excel', () => {
  it('replaces in every cell, ignoring case, formulas too', () => {
    expect(replaceIn([['Red team', '=SUM(red!A1)'], ['Blue']], 'red', 'Green')).toEqual([{ row: 0, col: 0, text: 'Green team' }, { row: 0, col: 1, text: '=SUM(Green!A1)' }]);
  });
  it('replaces in one cell only, and never with an empty query', () => {
    expect(replaceIn([['a.b', 'a.b']], 'a.b', 'x', { r: 0, c: 1 })).toEqual([{ row: 0, col: 1, text: 'x' }]);
    expect(replaceIn([['a']], ' ', 'x')).toEqual([]);
  });
});
