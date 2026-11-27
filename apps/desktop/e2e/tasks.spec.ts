import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture, type Fixture, type Launched, removeTestData } from './harness';
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
/** A shared pop-up in Details (Repeat, List): open it and pick a choice by its words. */
async function choose(scope: Locator, label: string, choice: string): Promise<void> {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await shell().getByRole('option', { name: choice, exact: true }).click();
}
const lists = (): Locator => shell().getByRole('navigation', { name: 'Lists' });
/** Details: the right panel while a task is picked. */
const details = (): Locator => shell().getByRole('complementary', { name: 'Details' });
const todo = (): Locator => page().getByRole('list', { name: 'To do' });
const file = (list: string) => path.join(userData, 'workspace', 'tasks', `${list}.md`);
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  // Room for the whole toolbar: in a narrow window its controls move into the ⋯ menu.
  await resizeWindow(mobius.app, 1440, 900);
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Tasks');
  await shell().keyboard.press('Enter');
  await expect(page()).toBeVisible();
}

test('a task typed into a list is a line in a real file, and ticking it off folds it away', async () => {
  await start();
  await lists().getByRole('button', { name: /^Inbox/ }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Inbox');
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
  await expect.poll(() => fs.readFileSync(file('Inbox'), 'utf8')).toBe(`# Inbox\n\n- [x] Call the plumber (done ${isoToday()})\n`);
  // Clearing them is in the Completed fold's own menu (and the window's ⋯ menu), not a button in the toolbar.
  await page().getByRole('button', { name: 'More for Completed' }).click({ force: true });
  await shell().getByRole('menuitem', { name: 'Clear 1 completed' }).click();
  await expect(page().getByText('Completed · 1')).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Inbox'), 'utf8')).toBe('# Inbox\n\n');
});

test('"task …" in Ctrl+K adds a task to Inbox, with the day said at the end, without leaving the app', async () => {
  await start();
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('task Water the plants tomorrow');
  const row = shell().getByRole('option', { name: /Add task “Water the plants”/ });
  await expect(row).toContainText('to Inbox, due');
  await row.click();
  await expect(shell().getByText('Added to Inbox')).toBeVisible();
  await expect.poll(() => fs.existsSync(file('Inbox')) ? fs.readFileSync(file('Inbox'), 'utf8') : '').toContain('- [ ] Water the plants');
  await lists().getByRole('button', { name: /^Inbox/ }).click();
  await expect(todo().getByRole('checkbox', { name: 'Water the plants' })).toBeVisible();
});

test('rewording, dates in plain words, new lists, and Today gathering from every list', async () => {
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), `# Home\nThoughts stay.\n- [ ] Paint the door (due ${isoToday()})\n- [ ] Fix the tap (due 2001-01-01)\n- [ ] Someday\n`);
  await start();
  // Today opens first and lists what is due or late, from every list, with the list it is in.
  await expect(shell().locator('.toolbar-sub')).toHaveText('Today');
  await expect(todo().getByRole('checkbox')).toHaveCount(2);
  await expect(todo().locator('.task').first()).toContainText('Fix the tap');
  await expect(todo().locator('.task').first().locator('.task-meta .task-due')).toHaveAttribute('data-tone', 'late');
  await expect(todo().locator('.task').nth(1)).toContainText('Today');
  await expect(todo().locator('.task').nth(1)).toContainText('Home');
  // The Mobius panel's Glance counts the day across every list: one late, one more for today, none flagged.
  await expect(shell().getByRole('region', { name: 'Your day' }).locator('.glance-fact')).toHaveText([/Overdue\s*1/, /Today\s*1/, /Flagged\s*0/]);

  await lists().getByRole('button', { name: /^Home/ }).click();
  await page().getByRole('button', { name: 'Someday', exact: true }).click();
  const edit = page().getByRole('textbox', { name: 'Edit Someday' });
  await edit.fill('Clean the gutters');
  await edit.press('Enter');
  await expect(todo().getByRole('checkbox', { name: 'Clean the gutters' })).toBeVisible();
  await page().getByRole('button', { name: 'Fix the tap', exact: true }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'No deadline' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toBe(`# Home\nThoughts stay.\n- [ ] Paint the door (due ${isoToday()})\n- [ ] Fix the tap\n- [ ] Clean the gutters\n`);

  // A change another editor makes to the file shows when the list is opened again.
  fs.appendFileSync(file('Home'), '- [ ] Added in another editor\n');
  await lists().getByRole('button', { name: /^Today/ }).click();
  await lists().getByRole('button', { name: /^Home/ }).click();
  await expect(todo().getByRole('checkbox', { name: 'Added in another editor' })).toBeVisible();

  await shell().getByRole('button', { name: 'New list' }).click();
  await shell().getByRole('textbox', { name: 'List name' }).fill('Groceries');
  await shell().getByRole('textbox', { name: 'List name' }).press('Enter');
  await expect(shell().locator('.toolbar-sub')).toHaveText('Groceries');
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
  await expect(row.locator('.task-meta .task-due')).toHaveAttribute('data-tone', 'late');
  expect(fs.readFileSync(file('Inbox'), 'utf8')).toContain('- [ ] Book the dentist (due 2001-02-03)');
  // The list changed under the person, but focus stayed where they were (in the agent panel).
  expect(await page().evaluate((el) => el.contains(document.activeElement))).toBe(false);
});

test('a task Mobius adds is marked as it lands, and Keep comes when the turn ends', async () => {
  // The answer comes slowly, so the turn is still running when the task is in the list.
  await start([callsTool('tasks-add', { list: 'Inbox', text: 'Call the venue' }), says(['Added ', 'it to your Inbox.'], 3000)]);
  await lists().getByRole('button', { name: /^Inbox/ }).click();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Remind me to call the venue');
  await composer.press('Enter');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  const row = todo().locator('.task', { hasText: 'Call the venue' });
  await expect(row).toHaveAttribute('data-proposed', 'true');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).not.toHaveText('Added it to your Inbox.');
  await expect(page().getByRole('button', { name: 'Keep' })).toHaveCount(0);
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added it to your Inbox.', { timeout: 15_000 });
  await expect(page().getByRole('button', { name: 'Keep' })).toBeVisible();
  await expect(row).toHaveAttribute('data-proposed', 'true');
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
  // The row's tools show on hover, after its date and flag.
  await page().getByRole('button', { name: 'Paint the door', exact: true }).hover();
  await page().getByRole('button', { name: 'Details for Paint the door' }).click();
  // Hiding the panel puts the task down; picking it again brings Details back.
  await shell().getByRole('button', { name: 'Hide Details' }).click();
  await expect(shell().getByRole('complementary', { name: 'Details' })).toHaveCount(0);
  // The row's tools show on hover, after its date and flag.
  await page().getByRole('button', { name: 'Paint the door', exact: true }).hover();
  await page().getByRole('button', { name: 'Details for Paint the door' }).click();
  const details = shell().getByRole('complementary', { name: 'Details' });
  await details.getByRole('textbox', { name: 'Notes' }).fill('White, not grey.');
  await details.getByRole('switch', { name: 'Flagged' }).click();
  await expect(details.getByRole('switch', { name: 'Flagged' })).toBeChecked();
  await details.getByRole('textbox', { name: 'New subtask' }).fill('Buy brushes');
  await details.getByRole('textbox', { name: 'New subtask' }).press('Enter');
  await expect(details.getByRole('checkbox', { name: 'Buy brushes' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toBe('# Home\n\n- [ ] Paint the door (flagged)\n  White, not grey.\n  - [ ] Buy brushes\n- [ ] Fix the tap\n');
  // The row shows the note, the flag and how many subtasks are done; Flagged gathers it.
  const row = todo().locator('.task', { hasText: 'Paint the door' }).first();
  await expect(row.locator('.task-note')).toHaveText('White, not grey.');
  // Open in the details, the row shows its tools where the flag and date were: Unflag says it is flagged.
  await expect(row.getByRole('button', { name: 'Unflag Paint the door' })).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('.task-subcount')).toHaveText('0/1');
  await choose(details, 'List', 'Garden');
  await expect.poll(() => fs.readFileSync(file('Garden'), 'utf8')).toBe('# Garden\n\n- [ ] Paint the door (flagged)\n  White, not grey.\n  - [ ] Buy brushes\n');
  // The move writes the new list, then takes the task out of the old one: two writes, so wait for the second.
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toBe('# Home\n\n- [ ] Fix the tap\n');
  await lists().getByRole('button', { name: /^Flagged/ }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Flagged');
  await expect(todo().getByRole('checkbox', { name: 'Paint the door' })).toBeVisible();
});

test('a date said in words becomes the due date, and a deleted task or list comes back with Undo', async () => {
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), '# Home\n\n- [ ] Paint the door\n  White, not grey.\n- [ ] Fix the tap\n');
  await start();
  await lists().getByRole('button', { name: /^Home/ }).click();
  const field = page().getByRole('textbox', { name: 'New task', exact: true });
  await field.fill('Call the plumber tomorrow');
  await expect(page().getByRole('button', { name: /^Deadline Tomorrow/ })).toBeVisible();
  await field.press('Enter');
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Call the plumber (due ${tomorrow})`);
  // Taking the chip back keeps the words as they were typed.
  await field.fill('Read Friday');
  await page().getByRole('button', { name: /^Deadline .*Keep “Friday” as words/ }).click();
  await field.press('Enter');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Read Friday\n');

  // The row's tools show on hover, after its date and flag.
  await page().getByRole('button', { name: 'Paint the door', exact: true }).hover();
  await page().getByRole('button', { name: 'Details for Paint the door' }).click();
  await details().getByRole('button', { name: 'Delete task' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).not.toContain('Paint the door');
  await page().getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Paint the door\n  White, not grey.\n- [ ] Fix the tap\n');

  await lists().getByRole('button', { name: 'More for Home' }).click({ force: true });
  await shell().getByRole('menuitem', { name: 'Rename…' }).click();
  await shell().getByRole('textbox', { name: 'New name for Home' }).fill('House');
  await shell().getByRole('textbox', { name: 'New name for Home' }).press('Enter');
  await expect(shell().locator('.toolbar-sub')).toHaveText('House');
  expect(fs.existsSync(file('Home'))).toBe(false);
  await lists().getByRole('button', { name: 'More for House' }).click({ force: true });
  await shell().getByRole('menuitem', { name: 'Delete list…' }).click();
  await shell().getByRole('alertdialog', { name: 'Delete House?' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => fs.existsSync(file('House'))).toBe(false);
  await expect(shell().locator('.toolbar-sub')).toHaveText('Today');
  await page().getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.existsSync(file('House'))).toBe(true);
  await expect(shell().locator('.toolbar-sub')).toHaveText('House');
});

test('Upcoming sorts by day, a task has a right-click menu, and the keyboard moves through and acts on tasks', async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), `# Home\n\n- [ ] Pay the gas bill (due ${day(-2)})\n- [ ] Fix the tap (due ${day(0)})\n- [ ] Paint the door (due ${day(1)})\n- [ ] Sand the shelf (when ${day(2)}) (due ${day(5)})\n`);
  fs.writeFileSync(file('Garden'), '# Garden\n\n');
  await start();
  await lists().getByRole('button', { name: /^Upcoming/ }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Upcoming');
  // Only what is after today, each on the day it is planned for, else its deadline (late and today's are in Today).
  await expect(page().getByRole('checkbox', { name: 'Pay the gas bill' })).toHaveCount(0);
  await expect(page().getByRole('region', { name: 'Tomorrow' }).getByRole('checkbox', { name: 'Paint the door' })).toBeVisible();
  await expect(page().locator('.tasks-day').nth(1).getByRole('checkbox', { name: 'Sand the shelf' })).toBeVisible();
  // Its deadline is another day, so the row still says it.
  await expect(page().locator('.task', { hasText: 'Sand the shelf' }).locator('.task-meta .task-due')).toBeVisible();

  // Right-click: flag it, then move it to another list.
  await lists().getByRole('button', { name: /^Home/ }).click();
  const tap = todo().locator('.task-line', { hasText: 'Fix the tap' });
  await tap.click({ button: 'right', position: { x: 4, y: 4 } });
  await shell().getByRole('menuitem', { name: 'Flag', exact: true }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(0)}) (flagged)`);
  await tap.click({ button: 'right', position: { x: 4, y: 4 } });
  await shell().getByRole('menuitem', { name: 'Deadline tomorrow' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(1)})`);
  await tap.click({ button: 'right', position: { x: 4, y: 4 } });
  await shell().getByRole('menuitem', { name: 'Move to Garden' }).click();
  await expect.poll(() => fs.readFileSync(file('Garden'), 'utf8')).toContain('Fix the tap');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).not.toContain('Fix the tap');
  // The list has been drawn again without it, so the arrow keys below move through the rows that stay.
  await expect(todo().locator('.task-line', { hasText: 'Fix the tap' })).toHaveCount(0);

  // Keyboard: down from the add field, down again, ⌘/Ctrl+I opens details, Space ticks (Ctrl+Z unticks), Delete deletes.
  await page().getByRole('textbox', { name: 'New task', exact: true }).press('ArrowDown');
  await expect(todo().locator('.task-line', { hasText: 'Pay the gas bill' })).toBeFocused();
  await shell().keyboard.press('ArrowDown');
  const door = todo().locator('.task-line', { hasText: 'Paint the door' });
  await expect(door).toBeFocused();
  await shell().keyboard.press('Control+i');
  await expect(details().getByRole('textbox', { name: 'Task', exact: true })).toHaveValue('Paint the door');
  await door.focus();
  await shell().keyboard.press('Space');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [x] Paint the door');
  // The keyboard stays in the list, on the task after the one that left; Ctrl+Z takes the tick back.
  await expect(todo().locator('.task-line', { hasText: 'Sand the shelf' })).toBeFocused();
  await expect(page().getByRole('status')).toContainText('Completed “Paint the door”');
  await shell().keyboard.press('Control+z');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Paint the door');
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
  // The row's tools show on hover, after its date and flag.
  await page().getByRole('button', { name: 'Fix the tap', exact: true }).hover();
  await page().getByRole('button', { name: 'Details for Fix the tap' }).click();
  const details = shell().getByRole('complementary', { name: 'Details' });
  await page().getByRole('button', { name: 'Fix the tap', exact: true }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Deadline tomorrow' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(1)})`);
  // Time is the shared time field: type it, and leaving the field keeps it.
  await details.getByRole('combobox', { name: 'Time', exact: true }).fill('09:30');
  await details.getByRole('combobox', { name: 'Time', exact: true }).press('Tab');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(1)} 09:30)`);
  await choose(details, 'Repeat', 'Every Month');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Fix the tap (due ${day(1)} 09:30) (every month)`);
  await details.getByRole('button', { name: 'No deadline', exact: true }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Fix the tap (every month)\n');
});

test('When and Deadline: Today, Someday and the Logbook, set from Details, the menu and the keyboard', async () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  fs.mkdirSync(path.dirname(file('Home')), { recursive: true });
  fs.writeFileSync(file('Home'), `# Home\n\n- [ ] Plan the trip (due ${day(9)})\n- [ ] Learn the banjo\n- [ ] Sweep the yard\n`);
  await start();
  await lists().getByRole('button', { name: /^Home/ }).click();
  // Details: When is apart from the deadline; Today plans it for today and Today lists it, deadline and all.
  await page().getByRole('button', { name: 'Plan the trip', exact: true }).hover();
  await page().getByRole('button', { name: 'Details for Plan the trip' }).click();
  await details().getByRole('group', { name: 'When' }).getByRole('button', { name: 'Today', exact: true }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [ ] Plan the trip (when ${day(0)}) (due ${day(9)})`);
  await lists().getByRole('button', { name: /^Today/ }).click();
  await expect(todo().getByRole('checkbox', { name: 'Plan the trip' })).toBeVisible();

  // The menu puts one off to Someday; the keyboard (Ctrl+O) another, and Ctrl+R brings it back to Anytime.
  await lists().getByRole('button', { name: /^Home/ }).click();
  await page().getByRole('button', { name: 'Learn the banjo', exact: true }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: /^Someday/ }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Learn the banjo (when someday)');
  const sweep = todo().locator('.task-line', { hasText: 'Sweep the yard' });
  await sweep.focus();
  await shell().keyboard.press('Control+o');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Sweep the yard (when someday)');
  await expect(todo().locator('.task', { hasText: 'Sweep the yard' }).locator('.task-plan')).toHaveText('Someday');
  await sweep.focus();
  await shell().keyboard.press('Control+r');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('- [ ] Sweep the yard\n');
  // Ctrl+↑ moves it above the task before it.
  await sweep.focus();
  await shell().keyboard.press('Control+ArrowUp');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toMatch(/Sweep the yard\n- \[ \] Learn the banjo/);
  // The keyboard stays on it, so it can move again.
  await expect(todo().locator('.task-line').nth(1)).toHaveAttribute('aria-label', 'Sweep the yard');
  await expect(sweep).toBeFocused();
  await shell().keyboard.press('Control+ArrowDown');
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toMatch(/Learn the banjo \(when someday\)\n- \[ \] Sweep the yard/);
  await expect(sweep).toBeFocused();
  await lists().getByRole('button', { name: /^Someday/ }).click();
  await expect(todo().getByRole('checkbox')).toHaveCount(1);
  await expect(todo().getByRole('checkbox', { name: 'Learn the banjo' })).toBeVisible();
  await lists().getByRole('button', { name: /^Anytime/ }).click();
  await expect(todo().getByRole('checkbox', { name: 'Learn the banjo' })).toHaveCount(0);

  // A task added in Someday is planned for Someday; ticking one off keeps the day, and the Logbook shows it under Today.
  const field = page().getByRole('textbox', { name: 'New task', exact: true });
  await lists().getByRole('button', { name: /^Someday/ }).click();
  await field.fill('Write a novel');
  await field.press('Enter');
  await expect.poll(() => fs.readFileSync(file('Inbox'), 'utf8')).toContain('- [ ] Write a novel (when someday)');
  await lists().getByRole('button', { name: /^Home/ }).click();
  await todo().getByRole('checkbox', { name: 'Sweep the yard' }).click();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain(`- [x] Sweep the yard (done ${day(0)})`);
  await lists().getByRole('button', { name: /^Logbook/ }).click();
  await expect(page().getByRole('region', { name: 'Today' }).getByRole('checkbox', { name: 'Sweep the yard' })).toBeVisible();
});

test('a list shown beside stays as a piece in other apps: tick and add there, open it in Tasks, put it away', async () => {
  fs.mkdirSync(path.dirname(file('Errands')), { recursive: true });
  fs.writeFileSync(file('Errands'), '# Errands\n\n- [ ] Post the parcel\n');
  await start();
  await lists().getByRole('button', { name: /^Errands/ }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Show beside' }).click();
  const piece = shell().getByRole('region', { name: 'Errands, from Tasks' });
  await expect(piece.getByRole('checkbox', { name: 'Post the parcel' })).toBeVisible();
  // Another app: the piece is still there, at the right, and works there.
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell().keyboard.press('Enter');
  await expect(shell().getByRole('complementary', { name: 'Notebooks' })).toBeVisible();
  await expect(piece).toBeVisible();
  const field = piece.getByRole('textbox', { name: 'New task', exact: true });
  await field.fill('Buy stamps');
  await field.press('Enter');
  await expect(piece.getByRole('checkbox', { name: 'Buy stamps' })).toBeVisible();
  await piece.getByRole('checkbox', { name: 'Post the parcel' }).click();
  await expect(piece.getByRole('checkbox', { name: 'Post the parcel' })).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Errands'), 'utf8')).toBe(`# Errands\n\n- [x] Post the parcel (done ${isoToday()})\n- [ ] Buy stamps\n`);
  // It is listed in the View menu with the app's panels, and kept across a restart of the window's layout.
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'View', exact: true }).click();
  await expect(shell().getByRole('menu', { name: 'View' }).getByRole('menuitemcheckbox', { name: 'Errands' })).toBeChecked();
  await shell().keyboard.press('Escape');
  // Open in Tasks goes to the list; Put away takes the piece off every app.
  await piece.getByRole('button', { name: 'Open in Tasks' }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Errands');
  // The list open in Tasks is not shown again beside it; another list brings the piece back.
  await expect(piece).toHaveCount(0);
  await lists().getByRole('button', { name: /^Today/ }).click();
  await piece.getByRole('button', { name: 'Put away Errands' }).click();
  await expect(piece).toHaveCount(0);
  expect(await shell().evaluate(() => localStorage.getItem('mobius.pieces'))).toBe('[]');
});

test('Mobius brings up the list it works in beside another app, and puts it away once its change is kept', async () => {
  fs.mkdirSync(path.dirname(file('Errands')), { recursive: true });
  fs.writeFileSync(file('Errands'), '# Errands\n\n- [ ] Post the parcel\n');
  // The answer comes slowly, so the piece comes while the turn still runs.
  await start([callsTool('tasks-add', { list: 'Errands', text: 'Buy stamps' }), says(['Added ', 'it to Errands.'], 3000)]);
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell().keyboard.press('Enter');
  await expect(shell().getByRole('complementary', { name: 'Notebooks' })).toBeVisible();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Remind me to buy stamps');
  await composer.press('Enter');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  const piece = shell().locator('section[data-panel="piece:tasks.list:Errands"]');
  await expect(piece.getByRole('checkbox', { name: 'Buy stamps' })).toBeVisible();
  await expect(piece).toHaveAttribute('data-mobius', /.*/);
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added it to Errands.', { timeout: 15_000 });
  // Still there while the change waits; Keep all takes it away.
  await expect(piece).toBeVisible();
  await shell().getByRole('region', { name: 'Changes from the last turn' }).getByRole('button', { name: /^Keep all changes/ }).click();
  await expect(piece).toHaveCount(0);
  expect(await shell().evaluate(() => localStorage.getItem('mobius.pieces'))).toBe('[]');
});

test('a piece Mobius brought goes when its change is discarded', async () => {
  fs.mkdirSync(path.dirname(file('Errands')), { recursive: true });
  fs.writeFileSync(file('Errands'), '# Errands\n\n- [ ] Post the parcel\n');
  // The answer comes slowly, so the piece comes while the turn still runs.
  await start([callsTool('tasks-add', { list: 'Errands', text: 'Buy stamps' }), says(['Added ', 'it to Errands.'], 3000)]);
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell().keyboard.press('Enter');
  await expect(shell().getByRole('complementary', { name: 'Notebooks' })).toBeVisible();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Remind me to buy stamps');
  await composer.press('Enter');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  const piece = shell().locator('section[data-panel="piece:tasks.list:Errands"]');
  await expect(piece.getByRole('checkbox', { name: 'Buy stamps' })).toBeVisible();
  await expect(piece).toHaveAttribute('data-mobius', /.*/);
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added it to Errands.', { timeout: 15_000 });
  // Discard in Tasks takes it away too, and puts the list back.
  await expect(piece).toBeVisible();
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Tasks');
  await shell().keyboard.press('Enter');
  await lists().getByRole('button', { name: /^Errands/ }).click();
  await page().getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(piece).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Errands'), 'utf8')).toBe('# Errands\n\n- [ ] Post the parcel\n');
  // A piece whose list is gone puts itself away.
  await lists().getByRole('button', { name: /^Today/ }).click();
  await lists().getByRole('button', { name: /^Errands/ }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Show beside' }).click();
  await expect(piece).toBeVisible();
  await lists().getByRole('button', { name: 'More for Errands' }).click({ force: true });
  await shell().getByRole('menuitem', { name: 'Delete list…' }).click();
  await shell().getByRole('alertdialog', { name: 'Delete Errands?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(piece).toHaveCount(0);
});

test('a piece Mobius brought stays once the person uses it, and Esc puts away only Mobius\'s', async () => {
  fs.mkdirSync(path.dirname(file('Errands')), { recursive: true });
  fs.writeFileSync(file('Errands'), '# Errands\n\n- [ ] Post the parcel\n');
  await start([callsTool('tasks-add', { list: 'Errands', text: 'Buy stamps' }), says(['Added it to Errands.'])]);
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell().keyboard.press('Enter');
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Remind me to buy stamps');
  await composer.press('Enter');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  const piece = shell().locator('section[data-panel="piece:tasks.list:Errands"]');
  await expect(piece.getByRole('checkbox', { name: 'Buy stamps' })).toBeVisible();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added it to Errands.');
  // Esc away from any field puts Mobius's piece away.
  await shell().locator('body').click({ position: { x: 2, y: 2 } }).catch(() => undefined);
  await shell().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shell().keyboard.press('Escape');
  await expect(piece).toHaveCount(0);
  // Shown again by the person, it is theirs: Esc leaves it.
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Tasks');
  await shell().keyboard.press('Enter');
  await lists().getByRole('button', { name: /^Today/ }).click();
  await lists().getByRole('button', { name: /^Errands/ }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Show beside' }).click();
  await expect(piece).toBeVisible();
  await shell().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shell().keyboard.press('Escape');
  await expect(piece).toBeVisible();
  await expect(piece).not.toHaveAttribute('data-mobius', /.*/);
});

test('a piece folds to its header, so the others beside it have the room, and opens again', async () => {
  fs.mkdirSync(path.dirname(file('Errands')), { recursive: true });
  fs.writeFileSync(file('Errands'), '# Errands\n\n- [ ] Post the parcel\n');
  fs.writeFileSync(file('Home'), '# Home\n\n- [ ] Fix the gate\n');
  await start();
  for (const list of ['Errands', 'Home']) {
    await lists().getByRole('button', { name: new RegExp(`^${list}`) }).click({ button: 'right' });
    await shell().getByRole('menuitem', { name: 'Show beside' }).click();
  }
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell().keyboard.press('Enter');
  const errands = shell().locator('section[data-panel="piece:tasks.list:Errands"]');
  const home = shell().locator('section[data-panel="piece:tasks.list:Home"]');
  await expect(errands.getByRole('checkbox', { name: 'Post the parcel' })).toBeVisible();
  const before = (await home.boundingBox())!.height;
  await errands.getByRole('button', { name: 'Fold Errands' }).click();
  await expect(errands.getByRole('checkbox', { name: 'Post the parcel' })).toBeHidden();
  await expect.poll(async () => (await home.boundingBox())!.height).toBeGreaterThan(before + 50);
  await expect(errands.getByRole('button', { name: 'Open Errands' })).toHaveAttribute('aria-expanded', 'false');
  // A double click on its header opens it again.
  await errands.locator('.ui-panel-head').dblclick({ position: { x: 40, y: 10 } });
  await expect(errands.getByRole('checkbox', { name: 'Post the parcel' })).toBeVisible();
});
