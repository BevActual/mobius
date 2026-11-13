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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-tasks-'));
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
const page = (): Locator => shell().locator('.tasks-page');
const lists = (): Locator => shell().getByRole('navigation', { name: 'Lists' });
const todo = (): Locator => page().getByRole('list', { name: 'To do' });
const file = (list: string) => path.join(userData, 'workspace', 'tasks', `${list}.md`);
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Tasks');
  await shell().keyboard.press('Enter');
  await expect(page()).toBeVisible();
}

test('a task typed into a list is a line in a real file, and ticking it off folds it away', async () => {
  await start();
  await lists().getByRole('button', { name: /^Inbox/ }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  const field = page().getByRole('textbox', { name: 'New task', exact: true });
  await field.fill('Call the plumber');
  await field.press('Enter');
  await expect(todo().getByRole('checkbox', { name: 'Call the plumber' })).toBeVisible();
  await expect(field).toHaveValue('');
  expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
  expect(fs.readFileSync(file('Inbox'), 'utf8')).toBe('# Inbox\n\n- [ ] Call the plumber\n');
  await expect(lists().getByRole('button', { name: /^Inbox/ })).toContainText('1');

  await todo().getByRole('checkbox', { name: 'Call the plumber' }).click();
  await expect(todo().getByRole('checkbox')).toHaveCount(0);
  await expect(page().getByText('Completed · 1')).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Inbox'), 'utf8')).toBe('# Inbox\n\n- [x] Call the plumber\n');
  // Clearing them is the list's control in the toolbar, not a button inside the list.
  await shell().locator('.context-strip').getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Clear 1 completed' }).click();
  await expect(page().getByText('Completed · 1')).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Inbox'), 'utf8')).toBe('# Inbox\n\n');
});

test('rewording, dates in plain words, new lists, and Today gathering from every list', async () => {
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), `# Home\nThoughts stay.\n- [ ] Paint the door (due ${isoToday()})\n- [ ] Fix the tap (due 2001-01-01)\n- [ ] Someday\n`);
  await start();
  // Today opens first and lists what is due or late, from every list, with the list it is in.
  await expect(shell().locator('.strip-title')).toHaveText('Today');
  await expect(todo().getByRole('checkbox')).toHaveCount(2);
  await expect(todo().locator('.task').first()).toContainText('Fix the tap');
  await expect(todo().locator('.task').first().locator('.task-due')).toHaveAttribute('data-tone', 'late');
  await expect(todo().locator('.task').nth(1)).toContainText('Today');
  await expect(todo().locator('.task').nth(1)).toContainText('Home');

  await lists().getByRole('button', { name: /^Home/ }).click();
  await page().getByRole('button', { name: 'Someday', exact: true }).click();
  const edit = page().getByRole('textbox', { name: 'Edit Someday' });
  await edit.fill('Clean the gutters');
  await edit.press('Enter');
  await expect(todo().getByRole('checkbox', { name: 'Clean the gutters' })).toBeVisible();
  await page().getByRole('button', { name: 'Clear the due date for Fix the tap' }).click({ force: true });
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toBe(`# Home\nThoughts stay.\n- [ ] Paint the door (due ${isoToday()})\n- [ ] Fix the tap\n- [ ] Clean the gutters\n`);

  // A change another editor makes to the file shows when the list is opened again.
  fs.appendFileSync(file('Home'), '- [ ] Added in another editor\n');
  await lists().getByRole('button', { name: /^Today/ }).click();
  await lists().getByRole('button', { name: /^Home/ }).click();
  await expect(todo().getByRole('checkbox', { name: 'Added in another editor' })).toBeVisible();

  await shell().getByRole('button', { name: 'New list' }).click();
  await shell().getByRole('textbox', { name: 'List name' }).fill('Groceries');
  await shell().getByRole('textbox', { name: 'List name' }).press('Enter');
  await expect(shell().locator('.strip-title')).toHaveText('Groceries');
  expect(fs.existsSync(file('Groceries'))).toBe(true);
});

test('the agent adds a task from the panel beside the list, and it appears without taking focus', async () => {
  await start([callsTool('tasks-add', { list: 'Inbox', text: 'Book the dentist', due: '2001-02-03' }), says(['Added it to your Inbox.'])]);
  await lists().getByRole('button', { name: /^Inbox/ }).click();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Remind me to book the dentist');
  await composer.press('Enter');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added it to your Inbox.');
  const row = todo().locator('.task', { hasText: 'Book the dentist' });
  await expect(row).toBeVisible();
  await expect(row.locator('.task-due')).toHaveAttribute('data-tone', 'late');
  expect(fs.readFileSync(file('Inbox'), 'utf8')).toContain('- [ ] Book the dentist (due 2001-02-03)');
  // The list changed under the person, but focus stayed where they were (in the agent panel).
  expect(await page().evaluate((el) => el.contains(document.activeElement))).toBe(false);
});

test('a suggestion in Tasks attaches the open list, so the agent sees what is on it', async () => {
  fs.mkdirSync(path.dirname(file('Inbox')), { recursive: true });
  fs.writeFileSync(file('Inbox'), '# Inbox\n\n- [ ] Write the report\n');
  await start([says(['Start with the report.'])]);
  await lists().getByRole('button', { name: /^Inbox/ }).click();
  await shell().getByRole('group', { name: 'Suggestions' }).getByRole('button', { name: 'Plan my day' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Start with the report.');
  expect(JSON.stringify(model!.requests.at(-1)?.messages ?? [])).toContain('Write the report');
});

test('details beside the list: notes, a flag, subtasks and another list, all plain Markdown in the file', async () => {
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), '# Home\n\n- [ ] Paint the door\n- [ ] Fix the tap\n');
  fs.writeFileSync(file('Garden'), '# Garden\n\n');
  await start();
  await lists().getByRole('button', { name: /^Home/ }).click();
  await page().getByRole('button', { name: 'Details for Paint the door' }).click({ force: true });
  const details = page().getByRole('complementary', { name: 'Details' });
  await details.getByRole('textbox', { name: 'Notes' }).fill('White, not grey.');
  await details.getByRole('switch', { name: 'Flagged' }).check();
  await details.getByRole('textbox', { name: 'New subtask' }).fill('Buy brushes');
  await details.getByRole('textbox', { name: 'New subtask' }).press('Enter');
  await expect(details.getByRole('checkbox', { name: 'Buy brushes' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toBe('# Home\n\n- [ ] Paint the door (flagged)\n  White, not grey.\n  - [ ] Buy brushes\n- [ ] Fix the tap\n');
  // The row shows the note, the flag and how many subtasks are done; Flagged gathers it.
  const row = todo().locator('.task', { hasText: 'Paint the door' }).first();
  await expect(row.locator('.task-note')).toHaveText('White, not grey.');
  await expect(row.getByRole('img', { name: 'Flagged' })).toBeVisible();
  await expect(row.locator('.task-subcount')).toHaveText('0 of 1');
  await details.getByRole('combobox', { name: 'List' }).selectOption('Garden');
  await expect.poll(() => fs.readFileSync(file('Garden'), 'utf8')).toBe('# Garden\n\n- [ ] Paint the door (flagged)\n  White, not grey.\n  - [ ] Buy brushes\n');
  // The move writes the new list, then takes the task out of the old one: two writes, so wait for the second.
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toBe('# Home\n\n- [ ] Fix the tap\n');
  await lists().getByRole('button', { name: /^Flagged/ }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Flagged');
  await expect(todo().getByRole('checkbox', { name: 'Paint the door' })).toBeVisible();
});

test('a date said in words becomes the due date, and a deleted task or list comes back with Undo', async () => {
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), '# Home\n\n- [ ] Paint the door\n  White, not grey.\n- [ ] Fix the tap\n');
  await start();
  await lists().getByRole('button', { name: /^Home/ }).click();
  const field = page().getByRole('textbox', { name: 'New task', exact: true });
  await field.fill('Call the plumber tomorrow');
  await expect(page().getByRole('button', { name: /^Due Tomorrow/ })).toBeVisible();
  await field.press('Enter');
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Call the plumber (due ${tomorrow})`);
  // Taking the chip back keeps the words as they were typed.
  await field.fill('Read Friday');
  await page().getByRole('button', { name: /^Due .*Keep “Friday” as words/ }).click();
  await field.press('Enter');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Read Friday\n');

  await page().getByRole('button', { name: 'Details for Paint the door' }).click({ force: true });
  await page().getByRole('button', { name: 'Delete task' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).not.toContain('Paint the door');
  await page().getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Paint the door\n  White, not grey.\n- [ ] Fix the tap\n');

  await lists().getByRole('button', { name: 'More for Home' }).click({ force: true });
  await shell().getByRole('menuitem', { name: 'Rename…' }).click();
  await shell().getByRole('textbox', { name: 'New name for Home' }).fill('House');
  await shell().getByRole('textbox', { name: 'New name for Home' }).press('Enter');
  await expect(shell().locator('.strip-title')).toHaveText('House');
  expect(fs.existsSync(file('Home'))).toBe(false);
  await lists().getByRole('button', { name: 'More for House' }).click({ force: true });
  await shell().getByRole('menuitem', { name: 'Delete list…' }).click();
  await shell().getByRole('alertdialog', { name: 'Delete House?' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => fs.existsSync(file('House'))).toBe(false);
  await expect(shell().locator('.strip-title')).toHaveText('Today');
  await page().getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.existsSync(file('House'))).toBe(true);
  await expect(shell().locator('.strip-title')).toHaveText('House');
});

test('Scheduled sorts by day, a task has a right-click menu, and the keyboard moves through and acts on tasks', async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), `# Home\n\n- [ ] Pay the gas bill (due ${day(-2)})\n- [ ] Fix the tap (due ${day(0)})\n- [ ] Paint the door (due ${day(1)})\n`);
  fs.writeFileSync(file('Garden'), '# Garden\n\n');
  await start();
  await lists().getByRole('button', { name: /^Scheduled/ }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Scheduled');
  await expect(page().getByRole('region', { name: 'Overdue' }).getByRole('checkbox', { name: 'Pay the gas bill' })).toBeVisible();
  await expect(page().getByRole('region', { name: 'Today' }).getByRole('checkbox', { name: 'Fix the tap' })).toBeVisible();
  await expect(page().getByRole('region', { name: 'Tomorrow' }).getByRole('checkbox', { name: 'Paint the door' })).toBeVisible();

  // Right-click: flag it, then move it to another list.
  await lists().getByRole('button', { name: /^Home/ }).click();
  const tap = todo().locator('.task-line', { hasText: 'Fix the tap' });
  await tap.click({ button: 'right', position: { x: 4, y: 4 } });
  await shell().getByRole('menuitem', { name: 'Flag', exact: true }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(0)}) (flagged)`);
  await tap.click({ button: 'right', position: { x: 4, y: 4 } });
  await shell().getByRole('menuitem', { name: 'Due Tomorrow' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(1)})`);
  await tap.click({ button: 'right', position: { x: 4, y: 4 } });
  await shell().getByRole('menuitem', { name: 'Move to Garden' }).click();
  await expect.poll(() => fs.readFileSync(file('Garden'), 'utf8')).toContain('Fix the tap');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).not.toContain('Fix the tap');

  // Keyboard: down from the add field, down again, ⌘/Ctrl+I opens details, Space ticks, Delete deletes.
  await page().getByRole('textbox', { name: 'New task', exact: true }).press('ArrowDown');
  await expect(todo().locator('.task-line', { hasText: 'Pay the gas bill' })).toBeFocused();
  await shell().keyboard.press('ArrowDown');
  const door = todo().locator('.task-line', { hasText: 'Paint the door' });
  await expect(door).toBeFocused();
  await shell().keyboard.press('Control+i');
  await expect(page().getByRole('complementary', { name: 'Details' }).getByRole('textbox', { name: 'Task', exact: true })).toHaveValue('Paint the door');
  await door.focus();
  await shell().keyboard.press('Space');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [x] Paint the door');
  await todo().locator('.task-line', { hasText: 'Pay the gas bill' }).focus();
  await shell().keyboard.press('Delete');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).not.toContain('Pay the gas bill');
  await page().getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('Pay the gas bill');
});

test('a task can have a time and repeat: typed in words, set in Details, and ticking it off moves it to its next day', async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), `# Home\n\n- [ ] Water the plants (due ${day(0)} 08:00) (every week)\n- [ ] Fix the tap\n`);
  await start();
  await lists().getByRole('button', { name: /^Home/ }).click();
  // The row says it repeats; ticking it off moves it a week on and leaves it open.
  await expect(todo().locator('.task', { hasText: 'Water the plants' }).getByRole('img', { name: 'Repeats every week' })).toBeVisible();
  await todo().getByRole('checkbox', { name: 'Water the plants' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Water the plants (due ${day(7)} 08:00) (every week)`);
  await expect(todo().getByRole('checkbox', { name: 'Water the plants' })).toBeVisible();

  // A time said after the day sets both.
  const field = page().getByRole('textbox', { name: 'New task', exact: true });
  await field.fill('Call the plumber tomorrow at 3pm');
  await field.press('Enter');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Call the plumber (due ${day(1)} 15:00)`);

  // Details: a date, then a time and a repeat; no date clears the time too.
  await page().getByRole('button', { name: 'Details for Fix the tap' }).click({ force: true });
  const details = page().getByRole('complementary', { name: 'Details' });
  await details.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await details.getByLabel('Time', { exact: true }).fill('09:30');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(1)} 09:30)`);
  await details.getByRole('combobox', { name: 'Repeat' }).selectOption('month');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(1)} 09:30) (every month)`);
  await details.getByRole('button', { name: 'No date', exact: true }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Fix the tap (every month)\n');
});
