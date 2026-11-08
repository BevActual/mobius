import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-sheets-'));
  const book = path.join(userData, 'workspace', 'sheets', 'Offsite budget');
  fs.mkdirSync(book, { recursive: true });
  fs.writeFileSync(path.join(book, 'Budget.csv'), 'Item,Qty,Unit,Total\nHotel,14,320,=B2*C2\nTerrace venue,1,620,=B3*C3\nLunch,=People!B1,40,=B4*C4\nTotal,,,=SUM(D2:D4)\n');
  fs.writeFileSync(path.join(book, 'People.csv'), 'People,8\n');
  fs.writeFileSync(path.join(book, '.order'), '["Budget","People"]');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const grid = (): Locator => shell().getByRole('grid');
const cell = (name: string): Locator => grid().getByRole('gridcell', { name, exact: true });
const file = (sheet: string) => path.join(userData, 'workspace', 'sheets', 'Offsite budget', `${sheet}.csv`);

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Sheets');
  await shell().keyboard.press('Enter');
  await shell().getByRole('navigation', { name: 'Workbooks' }).getByRole('button', { name: /^Offsite budget/ }).click();
  await expect(grid()).toBeVisible();
}

test('a workbook of CSV sheets shows its formulas worked out, and typing in a cell works the rest out again', async () => {
  await start();
  await expect(cell('D5')).toHaveText('5420');
  await cell('D5').click();
  await expect(shell().getByRole('textbox', { name: 'Cell contents' })).toHaveValue('=SUM(D2:D4)');
  await shell().getByRole('tablist', { name: 'Sheets' }).getByRole('tab', { name: 'People' }).click();
  await cell('B1').click();
  await shell().keyboard.type('10');
  await shell().keyboard.press('Enter');
  await expect.poll(() => fs.readFileSync(file('People'), 'utf8')).toBe('People,10\n');
  await shell().getByRole('tablist', { name: 'Sheets' }).getByRole('tab', { name: 'Budget' }).click();
  await expect(cell('D4')).toHaveText('400');
  await expect(cell('D5')).toHaveText('5500');

  // A formula typed in the formula bar; a mistake shows as the spreadsheet error.
  await cell('E2').click();
  const bar = shell().getByRole('textbox', { name: 'Cell contents' });
  await bar.fill('=D2/0');
  await bar.press('Enter');
  await expect(cell('E2')).toHaveText('#DIV/0!');
  expect(fs.readFileSync(file('Budget'), 'utf8')).toContain('Hotel,14,320,=B2*C2,=D2/0\n');
});

test('the agent adds a column of formulas, its cells are marked, and Discard puts the sheet back', async () => {
  await start([
    callsTool('sheets-read', { workbook: 'Offsite budget', sheet: 'Budget' }),
    callsTool('sheets-write', { workbook: 'Offsite budget', sheet: 'Budget', cells: { E1: 'Per person', E2: '=ROUND(D2/People!B1,2)', E3: '=ROUND(D3/People!B1,2)', E4: '=ROUND(D4/People!B1,2)', E5: '=SUM(E2:E4)' } }),
    says(['Each person costs $677.50 (E5).']),
  ]);
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('What does each person cost?');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('button', { name: 'Allow once' }).first().click();
  await log.getByRole('group', { name: 'Approval needed: sheets.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toHaveText('Each person costs $677.50 (E5).');
  await expect(cell('E5')).toHaveText('677.5');
  await expect(grid().locator('td[data-changed]')).toHaveCount(5);
  await expect(shell().getByRole('status').filter({ hasText: 'Mobius changed 5 cells here' })).toBeVisible();
  await shell().getByRole('status').filter({ hasText: 'Mobius changed 5 cells here' }).getByRole('button', { name: 'Discard' }).click();
  await expect(cell('E5')).toHaveText('');
  expect(fs.readFileSync(file('Budget'), 'utf8')).not.toContain('Per person');
});
