import { describe, expect, it } from 'vitest';
import { closeFormula, fillSeries, hasFooter, jump, quickTarget, refsIn, selectionGlance, selectionStats, shiftFormula, sortedRows, typingFunction, wantsRef } from './sheets-view';

describe('formulas moved and read', () => {
  it('moves relative references and keeps $ ones, other sheets and quoted text', () => {
    expect(shiftFormula('=B2*C2', 1, 0)).toBe('=B3*C3');
    expect(shiftFormula('=SUM(D2:D4)+$A$1', 0, 1)).toBe('=SUM(E2:E4)+$A$1');
    expect(shiftFormula('=People!B1*2', 1, 0)).toBe('=People!B2*2');
    expect(shiftFormula('=IF(A1>0,"A1",B1)', 1, 0)).toBe('=IF(A2>0,"A1",B2)');
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
    expect(shiftFormula('plain A1', 1, 0)).toBe('plain A1');
    expect(shiftFormula('=B4*People!B1+$C$1+D9', -2, 0, 3)).toBe('=B2*People!B1+$C$1+D9');
  });
  it('finds the ranges a formula points at, but not function names', () => {
    expect(refsIn('=SUM(D2:D4)+B1')).toEqual([{ r0: 1, c0: 3, r1: 3, c1: 3 }, { r0: 0, c0: 1, r1: 0, c1: 1 }]);
    expect(refsIn('=People!B1')).toEqual([]);
  });
  it('knows when a function name is being typed, and when a click would add a reference', () => {
    expect(typingFunction('=SU', 3)).toEqual({ start: 1, word: 'SU' });
    expect(typingFunction('=A1+ro', 6)).toEqual({ start: 4, word: 'ro' });
    expect(typingFunction('Sum', 3)).toBeNull();
    expect(wantsRef('=SUM(', 5)).toBe(true);
    expect(wantsRef('=A1', 3)).toBe(false);
  });
});

describe('filling, sorting and the status bar', () => {
  it('keeps a step, counts on text, moves formulas and repeats the rest', () => {
    expect(fillSeries(['1', '3'], 3, 'down')).toEqual(['5', '7', '9']);
    expect(fillSeries(['Week 1'], 2, 'down')).toEqual(['Week 2', 'Week 3']);
    expect(fillSeries(['=B2*C2'], 2, 'down')).toEqual(['=B3*C3', '=B4*C4']);
    expect(fillSeries(['=B2'], 1, 'right')).toEqual(['=C2']);
    expect(fillSeries(['Yes'], 2, 'down')).toEqual(['Yes', 'Yes']);
    expect(fillSeries(['5'], 2, 'down')).toEqual(['5', '5']);
  });
  it('sorts rows by a column, numbers first and empty last, formulas moving with their row', () => {
    const cells = [['Item', 'Qty', 'Cost'], ['Sled', '1', '6500'], ['Packs', '8', '48000'], ['Jig', '2', '=B4*1000'], ['', '', '']];
    const values = [['Item', 'Qty', 'Cost'], ['Sled', '1', '6500'], ['Packs', '8', '48000'], ['Jig', '2', '2000'], ['', '', '']];
    const out = sortedRows(cells, values, 1, 3, 2, true);
    const grid = cells.map((r) => [...r]);
    for (const { row, col, text } of out) grid[row]![col] = text;
    expect(grid.slice(1, 4)).toEqual([['Jig', '2', '=B2*1000'], ['Sled', '1', '6500'], ['Packs', '8', '48000']]);
    const again = cells.map((r) => [...r]);
    for (const { row, col, text } of sortedRows(cells, values, 1, 3, 0, false)) again[row]![col] = text;
    expect(again.slice(1, 4).map((r) => r[0])).toEqual(['Sled', 'Packs', 'Jig']);
  });
  it('sums, averages and counts what is selected', () => {
    expect(selectionStats(['10', '$20', 'x', ''])).toMatchObject({ count: 3, numbers: 2, sum: 30, average: 15, min: 10, max: 20 });
  });
  it('gives the panel Glance the sum, average and count, or only the count when nothing is a number', () => {
    expect(selectionGlance(selectionStats(['10', '$20', 'x', '']))).toEqual([
      { label: 'Sum', value: '30' }, { label: 'Average', value: '15' }, { label: 'Count', value: '3' },
    ]);
    expect(selectionGlance(selectionStats(['Sled', 'Packs', '']))).toEqual([{ label: 'Count', value: '2' }]);
  });
});

describe('moving about and quick formulas', () => {
  const cells = [['Item', 'Cost'], ['Packs', '48000'], ['Sled', '6500'], ['', '']];
  it('jumps to the edge of the filled block', () => {
    expect(jump(cells, 0, 1, 1, 0, 40, 10)).toEqual({ r: 2, c: 1 });
    expect(jump(cells, 2, 1, 1, 0, 40, 10)).toEqual({ r: 40, c: 1 });
  });
  it('puts a quick sum under the numbers above', () => {
    expect(quickTarget(cells, cells, { r0: 3, c0: 1, r1: 3, c1: 1 })).toEqual({ over: { r0: 1, c0: 1, r1: 2, c1: 1 }, at: { r: 3, c: 1 } });
    expect(quickTarget(cells, cells, { r0: 1, c0: 1, r1: 2, c1: 1 })).toEqual({ over: { r0: 1, c0: 1, r1: 2, c1: 1 }, at: { r: 3, c: 1 } });
  });
});

describe('finishing and footers', () => {
  it('closes open brackets and quotes', () => {
    expect(closeFormula('=ROUND(E2/1000,1')).toBe('=ROUND(E2/1000,1)');
    expect(closeFormula('=IF(A1>0,"yes')).toBe('=IF(A1>0,"yes")');
    expect(closeFormula('plain (')).toBe('plain (');
  });
  it('sees a total row under the data', () => {
    expect(hasFooter([['Item', 'Cost'], ['A', '1'], ['B', '2'], ['Total', '=SUM(B2:B3)']])).toBe(true);
    expect(hasFooter([['Item', 'Cost'], ['A', '1'], ['B', '=B2*2']])).toBe(false);
  });
});
