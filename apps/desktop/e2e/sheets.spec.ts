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

test('the open sheet and the chosen cell go with a message, as a chip that can be removed', async () => {
  await start([says(['Trimmed it.']), says(['Without the sheet.'])]);
  await cell('D2').click();
  const chip = shell().locator('.chip[data-here]');
  await expect(chip).toContainText('Offsite budget › Budget');
  await expect(shell().getByRole('button', { name: /^Sees this sheet/ })).toBeVisible();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Get this under the cap');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.msg.assistant').last()).toHaveText('Trimmed it.');
  const sent = JSON.stringify(model!.requests[0]);
  expect(sent).toContain('Selected: D2');
  expect(sent).toContain('D5: 5420 (=SUM(D2:D4))');
  // Removed, the next message goes without it, and the panel no longer says it sees the sheet.
  await shell().getByRole('button', { name: 'Remove Offsite budget › Budget' }).click();
  await expect(chip).toHaveCount(0);
  await expect(shell().getByRole('button', { name: /^Sees this sheet/ })).toHaveCount(0);
  await composer.fill('And in general?');
  await composer.press('Enter');
  await expect(log.locator('.msg.assistant').last()).toHaveText('Without the sheet.');
  const second = model!.requests.at(-1)!.messages as Array<{ role: string; content: unknown }>;
  expect(JSON.stringify(second.filter((m) => m.role === 'user').at(-1))).not.toContain('D5: 5420');
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

test('pick a block, fill it down, undo, sort from the menu, and build a formula by clicking cells', async () => {
  await start();
  // A dragged block shows its sum in the status line.
  const from = (await cell('B2').boundingBox())!;
  const to = (await cell('B3').boundingBox())!;
  await shell().mouse.move(from.x + 10, from.y + 10);
  await shell().mouse.down();
  await shell().mouse.move(to.x + 10, to.y + 10, { steps: 4 });
  await shell().mouse.up();
  await expect(shell().getByLabel('Selected cell')).toHaveText('B2:B3');
  await expect(shell().getByRole('status', { name: 'Selection' })).toContainText('Sum 15');

  // A formula from the function list, with a reference put in by clicking a cell.
  await cell('E2').click();
  await shell().keyboard.type('=rou');
  await expect(shell().getByRole('listbox', { name: 'Functions' }).getByRole('option').first()).toContainText('ROUND');
  await shell().keyboard.press('Tab');
  await cell('D2').click();
  await shell().keyboard.type('/14,0');
  await shell().keyboard.press('Enter');
  await expect(cell('E2')).toHaveText('320');
  await expect.poll(() => fs.readFileSync(file('Budget'), 'utf8')).toContain('Hotel,14,320,=B2*C2,"=ROUND(D2/14,0)"\n');

  // Filled down with Ctrl+D, the reference moving along; Undo takes it back.
  await cell('E2').click();
  await shell().keyboard.down('Shift');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.up('Shift');
  await shell().keyboard.press('Control+d');
  await expect.poll(() => fs.readFileSync(file('Budget'), 'utf8')).toContain('Terrace venue,1,620,=B3*C3,"=ROUND(D3/14,0)"\n');
  await shell().keyboard.press('Control+z');
  await expect.poll(() => fs.readFileSync(file('Budget'), 'utf8')).toContain('Terrace venue,1,620,=B3*C3\n');

  // Sorted by Total, smallest first, from the cell menu; the header and the total row stay put.
  await cell('D3').click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Cells' }).getByRole('menuitem', { name: 'Sort by D, A to Z' }).click();
  await expect(cell('A2')).toHaveText('Lunch');
  await expect(cell('A3')).toHaveText('Terrace venue');
  await expect(cell('A4')).toHaveText('Hotel');
  await expect(cell('A5')).toHaveText('Total');
  await expect(cell('D5')).toHaveText('5420');
  await expect.poll(() => fs.readFileSync(file('Budget'), 'utf8')).toBe('Item,Qty,Unit,Total\nLunch,=People!B1,40,=B2*C2\nTerrace venue,1,620,=B3*C3\nHotel,14,320,=B4*C4,"=ROUND(D4/14,0)"\nTotal,,,=SUM(D2:D4)\n');

  // Sorted again from column B's own menu, largest first: the whole column picked still leaves the header and total row put.
  await shell().getByRole('columnheader', { name: /^B/ }).hover();
  await shell().getByRole('button', { name: 'Column B options' }).click();
  await shell().getByRole('menu', { name: 'Column B' }).getByRole('menuitem', { name: 'Sort Z to A' }).click();
  await expect(cell('A2')).toHaveText('Hotel');
  await expect(cell('A4')).toHaveText('Terrace venue');
  await expect(cell('A5')).toHaveText('Total');
  await expect(shell().getByLabel('Selected cell')).toHaveText(/^B1:B\d+$/);
  // The total row reads as one, set apart from the rows it adds up.
  await expect(shell().locator('tr.sheet-footer-row')).toContainText('Total');

  // Ctrl+F finds cells by what they show, moving the selection from match to match; Escape closes it.
  await cell('A2').click();
  await shell().keyboard.press('Control+f');
  await shell().getByRole('searchbox', { name: 'Find in sheet' }).fill('e');
  await expect(shell().getByRole('search', { name: 'Find in sheet' })).toContainText(/1 of \d+/);
  const first = await shell().getByLabel('Selected cell').textContent();
  await shell().keyboard.press('Enter');
  await expect(shell().getByLabel('Selected cell')).not.toHaveText(first ?? '');
  await shell().getByRole('searchbox', { name: 'Find in sheet' }).fill('Terrace');
  await expect(shell().getByLabel('Selected cell')).toHaveText('A4');
  await shell().keyboard.press('Escape');
  await expect(shell().getByRole('search', { name: 'Find in sheet' })).toHaveCount(0);

  // Column D shown as currency from the Number format menu: the cell shows dollars, the file keeps the plain number.
  await cell('D2').click();
  await shell().getByRole('button', { name: 'Number format' }).click();
  await shell().getByRole('menu', { name: 'Number format' }).getByRole('menuitem', { name: /^Currency/ }).click();
  await expect(cell('D5')).toHaveText(/5[,. \u00a0\u202f]?420[.,]00/);
  await expect.poll(() => fs.readFileSync(file('Budget'), 'utf8')).toContain('Total,,,=SUM(D2:D4)\n');
  await expect(cell('A1')).toHaveText('Item');
});
