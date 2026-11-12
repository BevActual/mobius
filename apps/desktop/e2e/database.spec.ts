import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-database-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

const CSV = 'Name,Rooms,Price,Area\nCasa Amora,9,180.5,Principe Real\nLX Hotel,40,120,Alcantara\nMemmo,41,260,Alfama\n';

test('a CSV becomes a table to query; Mobius reads it without asking to change it, and its change can be discarded', async () => {
  model = await startModel([
    callsTool('db-query', { database: 'Data', sql: 'SELECT count(*) AS hotels, max(Price) AS top FROM hotels' }),
    says(['Three hotels; the dearest is 260 a night.']),
    callsTool('db-execute', { database: 'Data', sql: "UPDATE hotels SET Price = 999 WHERE Name = 'Memmo'" }),
    says(['Changed Memmo to 999.']),
  ]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  await expect(shell.getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Database');
  await shell.keyboard.press('Enter');

  // Importing makes a database called Data and opens the new table.
  await shell.getByRole('complementary', { name: 'Database sidebar' }).locator('input[type="file"]').setInputFiles({ name: 'hotels.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  const page = shell.getByRole('region', { name: 'Database' });
  const grid = page.getByRole('table', { name: 'Rows' });
  await expect(grid.getByRole('row')).toHaveCount(4);
  await expect(grid.getByRole('columnheader')).toHaveText(['Name', 'Rooms', 'Price', 'Area']);
  await expect(shell.getByRole('list', { name: 'Tables in Data' })).toContainText('hotels');
  expect(fs.existsSync(path.join(userData, 'workspace', 'databases', 'Data.sqlite'))).toBe(true);

  // Browsing needs no SQL: a column's heading sorts (again for high to low), the filter keeps rows holding the words,
  // and Structure lists the columns with their types.
  const price = grid.getByRole('columnheader', { name: 'Price' }).getByRole('button');
  await price.click();
  await price.click();
  await expect(grid.getByRole('columnheader', { name: 'Price' })).toHaveAttribute('aria-sort', 'descending');
  await expect(grid.getByRole('row').nth(1)).toContainText('Memmo');
  const filter = page.getByRole('searchbox', { name: 'Filter rows' });
  await filter.fill('alfama');
  await expect(grid.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('status')).toHaveText('1 row matches');
  await filter.fill('');
  await expect(grid.getByRole('row')).toHaveCount(4);
  await page.getByRole('radio', { name: 'Structure' }).click();
  await expect(page.getByRole('table', { name: 'Columns' }).getByRole('row', { name: /Rooms/ })).toContainText('INTEGER');

  // A statement of your own; a mistake says what is wrong.
  await page.getByRole('radio', { name: 'SQL' }).click();
  const sql = page.getByRole('textbox', { name: 'SQL' });
  await sql.fill('SELECT Area FROM hotels WHERE Rooms > 30 ORDER BY Area');
  await sql.press('Control+Enter');
  await expect(grid.getByRole('cell')).toHaveText(['Alcantara', 'Alfama']);
  await sql.fill('SELEC nope');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('alert')).toContainText('syntax error');

  // Mobius reads with db.query, which cannot change anything.
  await sql.fill('SELECT Name, Price FROM hotels ORDER BY Name');
  await sql.press('Control+Enter');
  await shell.getByRole('button', { name: 'Describe the data' }).click();
  const log = shell.getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: db.query' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('260 a night');
  expect(JSON.stringify(model.requests[0]!.messages)).toContain('hotels (3 rows): Name TEXT, Rooms INTEGER, Price REAL, Area TEXT');
  expect(JSON.stringify(model.requests[1]!.messages)).toMatch(/\[3,260(\.0)?\]/);

  // A change is asked about, shows what it did, and can be put back. The next message goes once this turn has ended,
  // as it does for a person: while Mobius works there is Stop, not Send.
  await expect(shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Make Memmo 999');
  await composer.press('Enter');
  await log.getByRole('group', { name: 'Approval needed: db.execute' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant').last()).toHaveText('Changed Memmo to 999.');
  await expect(grid.getByRole('row', { name: /Memmo/ })).toContainText('999');
  await expect(page.getByRole('status').filter({ hasText: 'Mobius changed this database' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await sql.press('Control+Enter');
  await expect(grid.getByRole('row', { name: /Memmo/ })).toContainText('260');
});

test('a sheet from Sheets becomes a table, with its worked-out values', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'sheets', 'Budget'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'sheets', 'Budget', 'Costs.csv'), 'Item,Cost\nHotel,1200\nFlights,800\nTotal,=SUM(B2:B3)\n');
  model = await startModel([]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  await expect(shell.getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Database');
  await shell.keyboard.press('Enter');
  const side = shell.getByRole('complementary', { name: 'Database sidebar' });
  await side.getByRole('button', { name: 'Import a sheet' }).click();
  await side.getByRole('group', { name: 'Import a sheet' }).getByRole('button', { name: 'Budget › Costs' }).click();
  const grid = shell.getByRole('region', { name: 'Database' }).getByRole('table', { name: 'Rows' });
  await expect(grid.getByRole('row', { name: /Total/ })).toContainText('2000');
  await expect(shell.getByRole('list', { name: 'Tables in Data' })).toContainText('Costs');

  // A table's menu renames it, and deletes it once asked.
  await side.getByRole('button', { name: 'More for Costs' }).click();
  await shell.getByRole('menuitem', { name: 'Rename…' }).click();
  const rename = side.getByRole('textbox', { name: 'New name for Costs' });
  await rename.fill('Trip costs');
  await rename.press('Enter');
  await expect(shell.getByRole('list', { name: 'Tables in Data' })).toContainText('Trip costs');
  await expect(shell.getByRole('region', { name: 'Database' }).getByRole('heading', { name: 'Trip costs' })).toBeVisible();
  await side.getByRole('button', { name: 'More for Trip costs' }).click();
  await shell.getByRole('menuitem', { name: 'Delete table…' }).click();
  await side.getByRole('alertdialog', { name: 'Delete the table “Trip costs”?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(shell.getByRole('list', { name: 'Tables in Data' })).toHaveText('No tables yet');
});
