import { describe, expect, it } from 'vitest';
import { findCells } from './sheets-view';

describe('finding in a sheet', () => {
  const cells = [['Item', 'Cost'], ['Battery packs', '=B3*2'], ['Sled hire', '6500'], ['Total', '=SUM(B2:B3)']];
  const values = [['Item', 'Cost'], ['Battery packs', '13000'], ['Sled hire', '6500'], ['Total', '19500']];
  it('finds what cells show, in reading order, whatever the case', () => {
    expect(findCells(cells, values, 'S')).toEqual([{ r: 0, c: 1 }, { r: 1, c: 0 }, { r: 2, c: 0 }, { r: 3, c: 1 }]);
    expect(findCells(cells, values, '6500')).toEqual([{ r: 2, c: 1 }]);
  });
  it('finds words in a formula, and nothing for an empty search', () => {
    expect(findCells(cells, values, 'sum(')).toEqual([{ r: 3, c: 1 }]);
    expect(findCells(cells, values, '  ')).toEqual([]);
  });
});
