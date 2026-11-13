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
const list = (): Locator => shell().getByRole('complementary', { name: 'Agent sidebar' });
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
/** Agents opens from All apps and the Agent app's sessions from Home in the rail, not from tabs in the sidebar. */
const railApps = (): Locator => shell().getByRole('navigation', { name: 'Apps' });
const tab = (name: 'Agents' | 'Sessions') => railApps().getByRole('button', { name: name === 'Agents' ? 'Agents' : 'Home', exact: true });
const openAgents = async () => {
  await railApps().locator('[data-app-library]').click();
  await shell().getByRole('dialog', { name: 'Applications' }).getByRole('region', { name: 'Mobius' }).getByRole('button', { name: 'Agents', exact: true }).click();
};
/** An agent's action, from its row's More menu. */
const fromMenu = async (agent: string, item: string) => {
  // A menu still closing would make the More button close it again rather than open it: wait until none is open.
  await expect(shell().getByRole('menu')).toHaveCount(0);
  await list().getByRole('button', { name: `More for ${agent}` }).click();
  await shell().getByRole('menu', { name: agent }).getByRole('menuitem', { name: item }).click();
  // A menu item runs once the menu has closed: wait for that, and for a new session to open empty.
  await expect(shell().getByRole('menu')).toHaveCount(0);
  if (item === 'New session') {
    await expect(tab('Sessions')).toHaveAttribute('aria-current', 'page');
    await expect(log().locator('.msg')).toHaveCount(0);
  }
};
async function newBot(name: string, instructions = '', modelName = ''): Promise<void> {
  await openAgents();
  await list().getByRole('button', { name: 'New agent' }).click();
  const form = shell().getByRole('form', { name: 'New agent' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Instructions').fill(instructions);
  await form.getByLabel('Model').fill(modelName);
  await form.getByRole('button', { name: 'Create' }).click();
  // The bot's first session opens a moment later, empty: wait for it, so what is said next goes to the bot.
  await expect(form).toHaveCount(0);
  await expect(tab('Sessions')).toHaveAttribute('aria-current', 'page');
  await expect(log().locator('.msg')).toHaveCount(0);
}

test('the side list switches between sessions and bots, and starts with Mobius alone', async () => {
  await start();
  await expect(tab('Sessions')).toHaveAttribute('aria-current', 'page');
  await openAgents();
  await expect(tab('Agents')).toHaveAttribute('aria-current', 'page');
  const rows = list().getByRole('region', { name: 'Agents' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Mobius');
  // Mobius is built in: its menu only starts a session.
  await list().getByRole('button', { name: 'More for Mobius' }).click();
  await expect(shell().getByRole('menu', { name: 'Mobius' }).getByRole('menuitem')).toHaveText(['New session']);
  await shell().keyboard.press('Escape');
  await expect(shell().getByRole('menu')).toHaveCount(0);
});

test('a bot is made, its sessions use its instructions and model, and other sessions do not', async () => {
  await start([says(['bot answer']), says(['plain answer'])], 'Be brief.');
  await newBot('Researcher', 'Always cite sources.', 'research-model');
  // Creating the bot puts you in a new session with it.
  await expect(tab('Sessions')).toHaveAttribute('aria-current', 'page');
  await say('hello bot');
  await expect(log().locator('.msg.assistant')).toHaveText('bot answer');
  const first = model!.requests.at(-1)!;
  expect(first.model).toBe('research-model');
  expect(JSON.stringify(first.messages)).toContain('Be brief.');
  expect(JSON.stringify(first.messages)).toContain('Always cite sources.');
  // A plain session keeps the usual setup.
  await shell().getByRole('button', { name: 'Create' }).click();
  await openAgents();
  await fromMenu('Mobius', 'New session');
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
  await openAgents();
  // An agent's row opens its page, whose Recent runs are its sessions; choosing one opens it.
  await list().getByRole('button', { name: /^Mobius/ }).first().click();
  const runs = shell().getByRole('list', { name: 'Sessions with Mobius' });
  await expect(runs).toContainText('plain question');
  await expect(runs).not.toContainText('writer question');
  await runs.getByRole('button', { name: /plain question/ }).click();
  await expect(log().locator('.msg.user')).toHaveText('plain question');
});

test('a bot can be renamed and its instructions changed, and the next message uses them', async () => {
  await start([says(['ok'])]);
  await newBot('Helper', 'Old rules.');
  await openAgents();
  await fromMenu('Helper', 'Edit…');
  const form = shell().getByRole('form', { name: 'Edit agent' });
  await form.getByLabel('Name').fill('Coach');
  await form.getByLabel('Instructions').fill('New rules.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(list().getByRole('region', { name: 'Agents' })).toContainText('Coach');
  await fromMenu('Coach', 'New session');
  await say('go');
  await expect(log().locator('.msg.assistant')).toHaveText('ok');
  const sent = JSON.stringify(model!.requests.at(-1)!.messages);
  expect(sent).toContain('New rules.');
  expect(sent).not.toContain('Old rules.');
});

test('a name already in use or an empty one is refused with a reason', async () => {
  await start();
  await newBot('Twin');
  await openAgents();
  await list().getByRole('button', { name: 'New agent' }).click();
  const form = shell().getByRole('form', { name: 'New agent' });
  await expect(form.getByRole('button', { name: 'Create' })).toBeDisabled();
  await form.getByLabel('Name').fill('twin');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(form.getByRole('alert')).toContainText('already an agent called');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(shell().getByRole('form', { name: 'New agent' })).toHaveCount(0);
});

test('removing a bot asks first, takes its sessions with it, and leaves the others', async () => {
  await start([says(['bot said']), says(['plain said'])]);
  await newBot('Temp');
  await say('to the bot');
  await expect(log().locator('.msg.assistant')).toHaveText('bot said');
  await shell().getByRole('button', { name: 'Create' }).click().catch(() => undefined);
  await openAgents();
  await fromMenu('Mobius', 'New session');
  await say('to mobius');
  await expect(log().locator('.msg.assistant')).toHaveText('plain said');
  await openAgents();
  await fromMenu('Temp', 'Remove…');
  await expect(list()).toContainText('Remove Temp and its session?');
  await list().getByRole('button', { name: 'Keep' }).click();
  await expect(list().getByRole('region', { name: 'Agents' })).toContainText('Temp');
  await fromMenu('Temp', 'Remove…');
  await list().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(list().getByRole('region', { name: 'Agents' })).not.toContainText('Temp');
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
  await openAgents();
  await expect(list().getByRole('region', { name: 'Agents' })).toContainText('Keeper');
  // Its model is on its page.
  await list().getByRole('button', { name: 'Keeper', exact: true }).click();
  await expect(shell().getByRole('region', { name: 'Keeper' }).filter({ hasText: 'What it does' })).toContainText('keeper-model');
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
  await openAgents();
  const names = async () => (await list().getByRole('region', { name: 'Agents' }).locator('.ui-side-name').allTextContents());
  await expect.poll(names).toEqual(['Mobius', 'Alpha', 'Beta', 'Gamma']);
  const menuItem = async (agent: string, item: string) => {
    await list().getByRole('button', { name: `More for ${agent}` }).click();
    const found = shell().getByRole('menu', { name: agent }).getByRole('menuitem', { name: item });
    await expect(found).toBeVisible();
    return found;
  };
  await expect(await menuItem('Alpha', 'Move up')).toBeDisabled();
  await shell().keyboard.press('Escape');
  await expect(shell().getByRole('menu')).toHaveCount(0);
  await expect(await menuItem('Gamma', 'Move down')).toBeDisabled();
  await shell().keyboard.press('Escape');
  await expect(shell().getByRole('menu')).toHaveCount(0);
  await fromMenu('Gamma', 'Move up');
  await expect.poll(names).toEqual(['Mobius', 'Alpha', 'Gamma', 'Beta']);
  await fromMenu('Alpha', 'Move down');
  await expect.poll(names).toEqual(['Mobius', 'Gamma', 'Alpha', 'Beta']);
  await list().getByRole('button', { name: 'More for Mobius' }).click();
  await expect(shell().getByRole('menuitem', { name: /Move/ })).toHaveCount(0);
  await shell().keyboard.press('Escape');
  await expect(shell().getByRole('menu')).toHaveCount(0);
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openApp('Agent');
  await openAgents();
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
  await row.getByRole('button', { name: /^Make .* an agent$/ }).click();
  const form = shell().getByRole('form', { name: 'New agent' });
  await expect(tab('Agents')).toHaveAttribute('aria-current', 'page');
  await expect(form.getByRole('textbox').nth(1)).toHaveValue(/Look at my tasks and calendar and plan the week/);
  await expect(form).toContainText('What it may touch');
  await form.getByRole('textbox').first().fill('Week planner');
  await form.getByRole('radio', { name: 'On a schedule' }).click();
  await form.getByLabel('At', { exact: true }).fill('07:30');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect.poll(async () => (await shell().evaluate(() => window.mobius.schedules?.list() ?? Promise.resolve([]))).map((s) => `${s.title} ${s.time}`)).toContain('Week planner 07:30');
  // The schedule runs as the new agent, not as Mobius.
  const schedules = await shell().evaluate(() => window.mobius.schedules?.list() ?? Promise.resolve([]));
  expect(schedules.find((s) => s.title === 'Week planner')?.bot).toMatch(/^[a-z0-9]{6}$/);
});
