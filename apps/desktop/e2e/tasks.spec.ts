import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched } from './harness';
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
  fs.rmSync(userData, { recursive: true, force: true });
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
  await page().getByRole('button', { name: 'Completed · 1' }).click();
  await page().getByRole('button', { name: 'Clear', exact: true }).click();
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
