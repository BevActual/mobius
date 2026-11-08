import { describe, expect, it } from 'vitest';
import { cellName, changedCells, columnName, isNumeric, parseCsv, pasted, sheetContext } from './sheets-view';

describe('sheets', () => {
  it('names columns and cells as spreadsheets do', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(cellName(1, 3)).toBe('D2');
  });
  it('reads the CSV the sheets are kept in', () => {
    expect(parseCsv('Item,Note\n"Hotel, Lisbon","He said ""yes""\nthen left"\n=SUM(A1:A2)\n')).toEqual([['Item', 'Note'], ['Hotel, Lisbon', 'He said "yes"\nthen left'], ['=SUM(A1:A2)']]);
  });
  it('finds the cells a turn changed, including new rows and cleared cells', () => {
    expect([...changedCells([['a', 'b'], ['c']], [['a', 'B'], [''], ['', 'x']])].sort()).toEqual(['0:1', '1:0', '2:1']);
  });
  it('lines numbers up and pastes from other spreadsheets', () => {
    expect(['4480', '$6,000', '-3.5', '12%', 'Hotel', '#DIV/0!'].map(isNumeric)).toEqual([true, true, true, true, false, false]);
    expect(pasted('a\tb\r\nc\td\n', 2, 1)).toEqual([{ row: 2, col: 1, text: 'a' }, { row: 2, col: 2, text: 'b' }, { row: 3, col: 1, text: 'c' }, { row: 3, col: 2, text: 'd' }]);
  });
  it('writes a sheet out for the agent with its formulas', () => {
    expect(sheetContext({ workbook: 'Trip', sheet: 'Budget', cells: [['Hotel', '320'], ['', '=B1*2']], values: [['Hotel', '320'], ['', '640']] })).toBe('# Trip › Budget\nA1: Hotel\nB1: 320\nB2: 640 (=B1*2)');
  });
});
