import { describe, expect, it } from 'vitest';
import { browseQuery, columnDecimals, showCellIn, countQuery, FIRST_BROWSE, nextSort, pageLine, renameTableSql, sqlString, sheetToCsv, databaseNameFor, isReading, quoteIdent, showCell, tableNameFor, tableQuery, toCsv } from './db-view';

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

  it('turns a sheet into CSV, leaving out the empty edges', () => {
    expect(sheetToCsv([['Name', 'Rooms', ''], ['Casa', '9', ''], ['', '', ''], ['', '', '']])).toBe('Name,Rooms\nCasa,9');
    expect(sheetToCsv([['', 'b'], ['1', '2']])).toBe('column_1,b\n1,2');
  });

  it('makes names from files and typing, and knows a statement that only reads', () => {
    expect(tableNameFor('Hotel prices (2026).csv')).toBe('Hotel_prices_2026');
    expect(tableNameFor('...csv')).toBe('imported');
    expect(databaseNameFor('  Trips/2026! ')).toBe('Trips2026');
    expect(isReading('-- hotels\nSELECT 1')).toBe(true);
    expect(isReading('with x as (select 1) select * from x')).toBe(true);
    expect(isReading('DELETE FROM t')).toBe(false);
  });

  it('writes the Data view\'s page: filtered in any column, sorted, a hundred rows at a time', () => {
    expect(browseQuery('hotels', ['Name', 'Rooms'], FIRST_BROWSE)).toBe('SELECT * FROM "hotels" LIMIT 100 OFFSET 0');
    expect(browseQuery('hotels', ['Name', 'Rooms'], { sort: { column: 'Rooms', desc: true }, filter: " O'Neil ", page: 2 })).toBe(
      'SELECT * FROM "hotels" WHERE instr(lower(CAST("Name" AS TEXT)), \'o\'\'neil\') > 0 OR instr(lower(CAST("Rooms" AS TEXT)), \'o\'\'neil\') > 0 ORDER BY "Rooms" DESC LIMIT 100 OFFSET 200');
    expect(countQuery('hotels', ['Name'], '')).toBe('SELECT count(*) FROM "hotels"');
    expect(sqlString("it's")).toBe("'it''s'");
    expect(renameTableSql('a"b', 'c')).toBe('ALTER TABLE "a""b" RENAME TO "c"');
  });

  it('sorts up, then down, then not; and says which rows show', () => {
    expect(nextSort(null, 'Price')).toEqual({ column: 'Price', desc: false });
    expect(nextSort({ column: 'Price', desc: false }, 'Price')).toEqual({ column: 'Price', desc: true });
    expect(nextSort({ column: 'Price', desc: true }, 'Price')).toBeNull();
    expect(nextSort({ column: 'Price', desc: true }, 'Name')).toEqual({ column: 'Name', desc: false });
    expect(pageLine(0, 3, 3, false)).toBe('3 rows');
    expect(pageLine(0, 1, 1, true)).toBe('1 row matches');
    expect(pageLine(1, 100, 1234, false)).toBe('101–200 of 1,234 rows');
    expect(pageLine(0, 0, 0, true)).toBe('No rows match');
  });

  it('gives a column of numbers one number of decimals', () => {
    expect(columnDecimals([[8420], [145.5], [21.75], [null]], 0)).toBe(2);
    expect(columnDecimals([[1], [2]], 0)).toBe(0);
    expect(showCellIn(8420, 2)).toBe((8420).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(showCellIn(12, 0)).toBe('12');
    expect(showCellIn(null, 2)).toBe('NULL');
  });
});
