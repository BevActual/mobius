import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture } from './model-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'The plan and questions are built in the Tauri shell');

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-plan-'));
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
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });

async function start(replies: Parameters<typeof startModel>[0]): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}
const say = async (text: string) => {
  await composer().fill(text);
  await composer().press('Enter');
};

test('the assistant keeps a plan you can follow, without asking permission for it', async () => {
  await start([
    callsTool('todo-write', { items: [{ text: 'Read the notes', status: 'done' }, { text: 'Write the summary', status: 'in_progress' }, { text: 'Check it', status: 'pending' }] }),
    says(['Summary written.']),
  ]);
  await say('summarise my notes');
  const plan = log().getByRole('region', { name: 'Plan' });
  await expect(plan).toContainText('1 of 3 done');
  await expect(plan.getByRole('listitem', { name: 'Write the summary: Working on it' })).toBeVisible();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Summary written.');
  // No approval card and no tool step for keeping a plan.
  await expect(log().getByRole('group', { name: /Approval needed/ })).toHaveCount(0);
  await expect(log()).not.toContainText('todo.write');
});

test('the assistant can ask you something, waits, and goes on with your answer', async () => {
  await start([callsTool('ask-person', { question: 'Which file should I tidy?', choices: ['notes.md', 'todo.md'] }), says(['Tidied todo.md.'])]);
  await say('tidy a file');
  const card = log().getByRole('group', { name: 'Mobius asks' });
  await expect(card).toContainText('Which file should I tidy?');
  await expect(shell().getByRole('status', { name: 'Mobius is working' })).toHaveCount(0);
  await card.getByRole('button', { name: 'todo.md' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Tidied todo.md.');
  await expect(card).toContainText('You answered: todo.md');
  const sent = JSON.stringify(model!.requests[1]!.messages);
  expect(sent).toContain('The person answered: todo.md');
});

test('a question can be answered in your own words, and is still there when the window reloads', async () => {
  await start([callsTool('ask-person', { question: 'What should the title be?' }), says(['Done.'])]);
  await say('make a page');
  await expect(log().getByRole('group', { name: 'Mobius asks' })).toBeVisible();
  await shell().reload();
  const card = log().getByRole('group', { name: 'Mobius asks' });
  await expect(card).toContainText('What should the title be?', { timeout: 15_000 });
  await card.getByRole('textbox', { name: 'Your answer' }).fill('Garden plans');
  await card.getByRole('button', { name: 'Answer' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Done.');
  expect(JSON.stringify(model!.requests[1]!.messages)).toContain('The person answered: Garden plans');
});

const toolNames = (request: Record<string, unknown> | undefined): string[] =>
  ((request?.tools as Array<{ function?: { name?: string }; name?: string }> | undefined) ?? []).map((t) => t.function?.name ?? t.name ?? '');

test('with Plan first, the assistant only proposes steps, and starts them when you say, as you changed them', async () => {
  await start([
    callsTool('todo-write', { items: [{ text: 'Read the notes', status: 'pending' }, { text: 'Write the summary in Notes', status: 'pending' }] }),
    says(['Here is the plan. Nothing happens until you start it.']),
    says(['Done.']),
  ]);
  const planFirst = shell().getByRole('button', { name: 'Plan first' });
  await planFirst.click();
  await expect(planFirst).toHaveAttribute('aria-pressed', 'true');
  await say('summarise my notes');
  const plan = log().getByRole('region', { name: 'Plan' });
  await expect(plan).toContainText('2 steps');
  await expect(plan).toContainText('Nothing happens until you start it');
  // The model was offered nothing but the plan and questions.
  expect(toolNames(model!.requests[0]).sort()).toEqual(['ask-person', 'todo-write']);
  await plan.getByRole('button', { name: 'Edit Plan' }).click();
  await plan.getByRole('textbox', { name: 'Step 2' }).fill('Write a three-line summary in Notes');
  await plan.getByRole('button', { name: 'Start' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Done.');
  const sent = JSON.stringify(model!.requests[2]!.messages);
  expect(sent).toContain('Go ahead with this plan, as I changed it');
  expect(sent).toContain('2. Write a three-line summary in Notes');
  expect(toolNames(model!.requests[2]).length).toBeGreaterThan(2);
  // Once started, the plan no longer waits for you.
  await expect(plan.getByRole('button', { name: 'Start' })).toHaveCount(0);
  // The choice is kept.
  await expect(planFirst).toHaveAttribute('aria-pressed', 'true');
});

test('I’ll Drive puts a proposed plan in Tasks, for you to do yourself', async () => {
  await start([
    callsTool('todo-write', { items: [{ text: 'Book the room', status: 'pending' }, { text: 'Send the invite', status: 'pending' }] }),
    says(['Here is the plan.']),
  ]);
  await shell().getByRole('button', { name: 'Plan first' }).click();
  await say('plan the offsite');
  const plan = log().getByRole('region', { name: 'Plan' });
  await plan.getByRole('button', { name: 'I’ll Drive' }).click();
  const tasks = shell().getByRole('list', { name: 'To do' });
  await expect(tasks).toContainText('Book the room');
  await expect(tasks).toContainText('Send the invite');
  expect(model!.requests).toHaveLength(2);
});

test('Take Over stops a running plan and puts the steps left in Tasks', async () => {
  await start([
    callsTool('todo-write', { items: [{ text: 'Find a venue', status: 'done' }, { text: 'Book the room', status: 'in_progress' }, { text: 'Send the invite', status: 'pending' }] }),
    says(['Working on the booking now', ' and then', ' the invite', ' after that.'], 1500),
  ]);
  await say('plan the offsite');
  const plan = log().getByRole('region', { name: 'Plan' });
  await expect(plan).toContainText('Step 2 of 3');
  await plan.getByRole('button', { name: 'Take Over' }).click();
  const tasks = shell().getByRole('list', { name: 'To do' });
  await expect(tasks).toContainText('Book the room');
  await expect(tasks).toContainText('Send the invite');
  await expect(tasks).not.toContainText('Find a venue');
  await expect(shell().getByRole('button', { name: 'Send', exact: true })).toBeVisible();
});

test('Mobius asks before remembering, uses what it remembers next time, and it can be forgotten in Settings', async () => {
  await start([callsTool('memory-remember', { text: 'Prefers boutique hotels' }), says(['I will remember that.']), says(['Noted.'])]);
  await say('I like boutique hotels');
  const card = log().getByRole('group', { name: 'Approval needed: memory.remember' });
  await expect(card).toContainText('Prefers boutique hotels');
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('I will remember that.');
  expect(fs.readFileSync(path.join(userData, 'memory.md'), 'utf8')).toContain('- Prefers boutique hotels');
  // The reply has finished (it can show its words while still streaming).
  await expect(shell().getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await say('find me a hotel');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Noted.');
  expect(JSON.stringify(model!.requests.at(-1))).toContain('Prefers boutique hotels');
  await shell().getByRole('button', { name: 'Settings', exact: true }).click();
  const page = shell().getByRole('region', { name: 'Settings' });
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Safety', exact: true }).click();
  await page.getByRole('tab', { name: 'Memory' }).click();
  const list = page.getByRole('list', { name: 'What Mobius remembers' });
  await expect(list).toContainText('Prefers boutique hotels');
  await list.getByRole('button', { name: 'Forget: Prefers boutique hotels' }).click();
  await expect(page).toContainText('Nothing yet');
  expect(fs.readFileSync(path.join(userData, 'memory.md'), 'utf8')).not.toContain('boutique');
});

test('a schedule is made in Settings, kept, and Run now starts it as a conversation of its own', async () => {
  await start([says(['Start with the invoices.'])]);
  await shell().getByRole('button', { name: 'Settings', exact: true }).click();
  const page = shell().getByRole('region', { name: 'Settings' });
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Schedules', exact: true }).click();
  await page.getByRole('button', { name: 'New schedule…' }).click();
  const form = page.getByRole('form', { name: 'Schedule' });
  await form.getByLabel('Name').fill('Morning brief');
  await form.getByLabel('What to ask').fill('What should I do first today?');
  await form.getByRole('button', { name: 'Saturday' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  const list = page.getByRole('list', { name: 'Schedules' });
  await expect(list).toContainText('Morning brief');
  await expect(list).toContainText('Mon, Tue, Wed, Thu, Fri, Sat at 08:00');
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'schedules.json'), 'utf8')) as Array<{ title: string; days: number[] }>;
  expect(saved[0]).toMatchObject({ title: 'Morning brief', days: [1, 2, 3, 4, 5, 6] });
  await list.getByRole('button', { name: 'Run now' }).click();
  await expect(page).toHaveCount(0);
  await expect(log().locator('.msg.assistant').last()).toHaveText('Start with the invoices.');
  await expect(log().locator('.msg.user')).toHaveText('What should I do first today?');
  expect(JSON.stringify(model!.requests[0])).toContain('What should I do first today?');
});

test('the Agent app’s Activity tab shows what finished today, and what is scheduled', async () => {
  await start([says(['Done.'])]);
  await say('tidy my inbox');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Done.');
  await shell().evaluate(() => window.mobius.schedules!.add({ title: 'Morning brief', prompt: 'Brief me', time: '08:00', days: [1, 2, 3, 4, 5], enabled: true }));
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
  await shell().keyboard.press('Enter');
  const side = shell().getByRole('complementary', { name: 'Conversation list' });
  await side.getByRole('tab', { name: 'Activity' }).click();
  await expect(side.getByRole('list', { name: 'Done today' })).toContainText('tidy my inbox');
  await expect(side.getByRole('list', { name: 'Scheduled requests' })).toContainText('Weekdays at 08:00');
});

test('profiles: Personal is there, a new one can be made in Settings, and the open one is marked', async () => {
  await start([]);
  await shell().getByRole('button', { name: 'Settings', exact: true }).click();
  const page = shell().getByRole('region', { name: 'Settings' });
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('tab', { name: 'Profiles' }).click();
  const list = page.getByRole('list', { name: 'Profiles' });
  await expect(list).toContainText('PersonalOpen now');
  await page.getByRole('textbox', { name: 'Name of the new profile' }).fill('Work');
  await page.getByRole('button', { name: 'New profile' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(1)).toContainText('Work');
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'profiles.json'), 'utf8')) as { current: string; list: { name: string }[] };
  expect(saved.current).toBe('default');
  expect(saved.list.map((p) => p.name)).toEqual(['Personal', 'Work']);
});
