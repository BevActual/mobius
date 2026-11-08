import { describe, expect, it } from 'vitest';
import { databaseNameFor, isReading, quoteIdent, showCell, tableNameFor, tableQuery, toCsv } from './db-view';

describe('database view', () => {
  it('quotes names and opens a table with its first rows', () => {
    expect(quoteIdent('my "table"')).toBe('"my ""table"""');
    expect(tableQuery('hotels')).toBe('SELECT * FROM "hotels" LIMIT 100;');
  });

  it('shows cells and copies rows as CSV', () => {
    expect(showCell(null)).toBe('NULL');
    expect(showCell(1 / 3)).toBe('0.333333');
    expect(showCell(42)).toBe('42');
    expect(showCell('x'.repeat(400)).length).toBe(301);
    expect(toCsv(['a', 'b'], [[1, 'x, y'], [null, 'say "hi"']])).toBe('a,b\n1,"x, y"\n,"say ""hi"""');
  });

  it('makes names from files and typing, and knows a statement that only reads', () => {
    expect(tableNameFor('Hotel prices (2026).csv')).toBe('Hotel_prices_2026');
    expect(tableNameFor('...csv')).toBe('imported');
    expect(databaseNameFor('  Trips/2026! ')).toBe('Trips2026');
    expect(isReading('-- hotels\nSELECT 1')).toBe(true);
    expect(isReading('with x as (select 1) select * from x')).toBe(true);
    expect(isReading('DELETE FROM t')).toBe(false);
  });
});
