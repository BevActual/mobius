import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-bots-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

async function start(replies: ModelReply[] = [], system = ''): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model', ...(system ? { MOBIUS_AGENT_SYSTEM: system } : {}) } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openApp('Agent');
  await expect(list()).toBeVisible();
}
const openApp = async (name: string) => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
  await shell().keyboard.press('Enter');
};
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const list = (): Locator => shell().getByRole('complementary', { name: 'Conversation list' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  // A bot's new session can open just after the text is typed and start with an empty box: type it again then.
  await expect(async () => {
    if ((await log().locator('.msg.user').filter({ hasText: text }).count()) > 0) return;
    await composer().fill(text);
    await composer().press('Enter');
    await expect(log().locator('.msg.user').filter({ hasText: text })).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
};
const tab = (name: string) => list().getByRole('tab', { name });
async function newBot(name: string, instructions = '', modelName = ''): Promise<void> {
  await tab('Bots').click();
  await list().getByRole('button', { name: 'New bot' }).click();
  const form = list().getByRole('form', { name: 'New bot' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Instructions').fill(instructions);
  await form.getByLabel('Model').fill(modelName);
  await form.getByRole('button', { name: 'Create' }).click();
  // The bot's first session opens a moment later, empty: wait for it, so what is said next goes to the bot.
  await expect(form).toHaveCount(0);
  await expect(tab('Sessions')).toHaveAttribute('aria-selected', 'true');
  await expect(log().locator('.msg')).toHaveCount(0);
}

test('the side list switches between sessions and bots, and starts with Mobius alone', async () => {
  await start();
  await expect(tab('Sessions')).toHaveAttribute('aria-selected', 'true');
  await tab('Bots').click();
  await expect(tab('Bots')).toHaveAttribute('aria-selected', 'true');
  const rows = list().getByRole('list', { name: 'Bots' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Mobius');
  await expect(list().getByRole('button', { name: /Edit Mobius|Remove Mobius/ })).toHaveCount(0);
});

test('a bot is made, its sessions use its instructions and model, and other sessions do not', async () => {
  await start([says(['bot answer']), says(['plain answer'])], 'Be brief.');
  await newBot('Researcher', 'Always cite sources.', 'research-model');
  // Creating the bot puts you in a new session with it.
  await expect(tab('Sessions')).toHaveAttribute('aria-selected', 'true');
  await say('hello bot');
  await expect(log().locator('.msg.assistant')).toHaveText('bot answer');
  const first = model!.requests.at(-1)!;
  expect(first.model).toBe('research-model');
  expect(JSON.stringify(first.messages)).toContain('Be brief.');
  expect(JSON.stringify(first.messages)).toContain('Always cite sources.');
  // A plain session keeps the usual setup.
  await list().getByRole('button', { name: 'New conversation' }).click();
  await tab('Bots').click();
  await list().getByRole('button', { name: 'New session with Mobius' }).click();
  await say('hello plain');
  await expect(log().locator('.msg.assistant')).toHaveText('plain answer');
  const second = model!.requests.at(-1)!;
  expect(second.model).toBe('chat-model');
  expect(JSON.stringify(second.messages)).not.toContain('Always cite sources.');
});

test('sessions are grouped under their bot and a bot opens its latest session', async () => {
  await start([says(['one']), says(['two'])]);
  await say('plain question');
  await expect(log().locator('.msg.assistant')).toHaveText('one');
  await newBot('Writer', 'Write well.');
  await say('writer question');
  await expect(log().locator('.msg.assistant')).toHaveText('two');
  await expect(list().getByRole('heading', { name: 'Writer' })).toBeVisible();
  await expect(list().getByRole('heading', { name: 'Mobius' })).toBeVisible();
  await expect(list().getByRole('region', { name: 'Writer' })).toContainText('writer question');
  await expect(list().getByRole('region', { name: 'Mobius' })).toContainText('plain question');
  await tab('Bots').click();
  await list().getByRole('button', { name: /^Mobius/ }).first().click();
  await expect(log().locator('.msg.user')).toHaveText('plain question');
});

test('a bot can be renamed and its instructions changed, and the next message uses them', async () => {
  await start([says(['ok'])]);
  await newBot('Helper', 'Old rules.');
  await tab('Bots').click();
  await list().getByRole('button', { name: 'Edit Helper' }).click();
  const form = list().getByRole('form', { name: 'Edit bot' });
  await form.getByLabel('Name').fill('Coach');
  await form.getByLabel('Instructions').fill('New rules.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(list().getByRole('list', { name: 'Bots' })).toContainText('Coach');
  await list().getByRole('button', { name: 'New session with Coach' }).click();
  await say('go');
  await expect(log().locator('.msg.assistant')).toHaveText('ok');
  const sent = JSON.stringify(model!.requests.at(-1)!.messages);
  expect(sent).toContain('New rules.');
  expect(sent).not.toContain('Old rules.');
});

test('a name already in use or an empty one is refused with a reason', async () => {
  await start();
  await newBot('Twin');
  await tab('Bots').click();
  await list().getByRole('button', { name: 'New bot' }).click();
  const form = list().getByRole('form', { name: 'New bot' });
  await expect(form.getByRole('button', { name: 'Create' })).toBeDisabled();
  await form.getByLabel('Name').fill('twin');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(form.getByRole('alert')).toContainText('already a bot called');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(list().getByRole('form', { name: 'New bot' })).toHaveCount(0);
});

test('removing a bot asks first, takes its sessions with it, and leaves the others', async () => {
  await start([says(['bot said']), says(['plain said'])]);
  await newBot('Temp');
  await say('to the bot');
  await expect(log().locator('.msg.assistant')).toHaveText('bot said');
  await list().getByRole('button', { name: 'New conversation' }).click().catch(() => undefined);
  await tab('Bots').click();
  await list().getByRole('button', { name: 'New session with Mobius' }).click();
  await say('to mobius');
  await expect(log().locator('.msg.assistant')).toHaveText('plain said');
  await tab('Bots').click();
  await list().getByRole('button', { name: 'Remove Temp' }).click();
  await expect(list()).toContainText('Remove Temp and its session?');
  await list().getByRole('button', { name: 'Keep' }).click();
  await expect(list().getByRole('list', { name: 'Bots' })).toContainText('Temp');
  await list().getByRole('button', { name: 'Remove Temp' }).click();
  await list().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(list().getByRole('list', { name: 'Bots' })).not.toContainText('Temp');
  await tab('Sessions').click();
  await expect(list()).not.toContainText('to the bot');
  await expect(list()).toContainText('to mobius');
});

test('bots and their sessions are still there after a restart', async () => {
  await start([says(['kept'])]);
  await newBot('Keeper', 'Remember me.', 'keeper-model');
  await say('persist this');
  await expect(log().locator('.msg.assistant')).toHaveText('kept');
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openApp('Agent');
  await tab('Bots').click();
  await expect(list().getByRole('list', { name: 'Bots' })).toContainText('Keeper');
  await expect(list().getByRole('list', { name: 'Bots' })).toContainText('keeper-model');
  await tab('Sessions').click();
  await expect(list().getByRole('region', { name: 'Keeper' })).toContainText('persist this');
});

test('a bot\'s group can be folded away, and stays folded after a restart', async () => {
  await start([says(['one']), says(['two'])]);
  await say('plain question');
  await expect(log().locator('.msg.assistant')).toHaveText('one');
  await newBot('Writer');
  await say('writer question');
  await expect(log().locator('.msg.assistant')).toHaveText('two');
  const toggle = list().getByRole('button', { name: /^Writer/ }).first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(list()).not.toContainText('writer question');
  await expect(list()).toContainText('plain question');
  await shell().reload();
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openApp('Agent');
  await expect(list().getByRole('button', { name: /^Writer/ }).first()).toHaveAttribute('aria-expanded', 'false');
  await list().getByRole('button', { name: /^Writer/ }).first().click();
  await expect(list()).toContainText('writer question');
});

test('searching the sessions shows only matches, even inside a folded group', async () => {
  await start([says(['one']), says(['two'])]);
  await say('apples are red');
  await expect(log().locator('.msg.assistant')).toHaveText('one');
  await newBot('Writer');
  await say('pears are green');
  await expect(log().locator('.msg.assistant')).toHaveText('two');
  await list().getByRole('button', { name: /^Writer/ }).first().click();
  const search = list().getByRole('searchbox', { name: 'Search sessions' });
  await search.fill('PEARS');
  await expect(list()).toContainText('pears are green');
  await expect(list()).not.toContainText('apples are red');
  await search.fill('nothing like this');
  await expect(list()).toContainText('No session matches');
  await search.fill('');
  await expect(list()).toContainText('apples are red');
});

test('bots can be moved up and down, Mobius stays first, and the order is kept', async () => {
  await start();
  for (const name of ['Alpha', 'Beta', 'Gamma']) await newBot(name);
  await tab('Bots').click();
  const names = async () => (await list().getByRole('list', { name: 'Bots' }).locator('.clist-title').allTextContents());
  await expect.poll(names).toEqual(['Mobius', 'Alpha', 'Beta', 'Gamma']);
  await expect(list().getByRole('button', { name: 'Move Alpha up' })).toBeDisabled();
  await expect(list().getByRole('button', { name: 'Move Gamma down' })).toBeDisabled();
  await list().getByRole('button', { name: 'Move Gamma up' }).click();
  await expect.poll(names).toEqual(['Mobius', 'Alpha', 'Gamma', 'Beta']);
  await list().getByRole('button', { name: 'Move Alpha down' }).click();
  await expect.poll(names).toEqual(['Mobius', 'Gamma', 'Alpha', 'Beta']);
  await expect(list().getByRole('button', { name: /Move Mobius/ })).toHaveCount(0);
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openApp('Agent');
  await tab('Bots').click();
  await expect.poll(names).toEqual(['Mobius', 'Gamma', 'Alpha', 'Beta']);
});

test('a conversation can be made a bot: its form is filled in from it, says what it may touch, and it can start on a schedule', async () => {
  await start([says(['Here is your week.'])]);
  await openApp('Agent');
  await say('Look at my tasks and calendar and plan the week');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Here is your week.');
  await tab('Sessions').click();
  // The row's own buttons show on hover, as Archive and Delete do.
  const row = list().getByRole('listitem').filter({ hasText: 'Look at my tasks and calendar' }).first();
  await row.hover();
  await row.getByRole('button', { name: /^Make .* a bot$/ }).click();
  const form = list().getByRole('form', { name: 'New bot' });
  await expect(tab('Bots')).toHaveAttribute('aria-selected', 'true');
  await expect(form.getByRole('textbox').nth(1)).toHaveValue(/Look at my tasks and calendar and plan the week/);
  await expect(form).toContainText('What it may touch');
  await form.getByRole('textbox').first().fill('Week planner');
  await form.getByLabel('Also on a schedule').check();
  await form.getByLabel('At', { exact: true }).fill('07:30');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect.poll(async () => (await shell().evaluate(() => window.mobius.schedules?.list() ?? Promise.resolve([]))).map((s) => `${s.title} ${s.time}`)).toContain('Week planner 07:30');
});
