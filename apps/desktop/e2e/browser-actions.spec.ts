import { expect, test, type Locator } from '@playwright/test';
import { launch, runInPage, startFixture, views, type Fixture, type Launched } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
});

async function start(replies: ModelReply[]): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/form', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};
const card = (tool: string) => shell().getByRole('group', { name: `Approval needed: ${tool}` });
const outText = async () => {
  const tab = (await views(mobius!.app))[0]!;
  return runInPage(mobius!.app, tab.id, 'document.getElementById("out").textContent');
};
/** What the model was told the last tool did. */
const lastToolMessage = (): string => {
  const messages = model!.requests.at(-1)!.messages as Array<{ role: string; content: string }>;
  return messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '';
};

test('typing into a field and submitting asks first, shows what it will do, and then does it', async () => {
  await start([callsTool('browser-type', { field: 'Search', text: 'blue shoes', submit: true }), says(['Searched.'])]);
  await say('search for shoes');
  const approval = card('browser.type');
  await expect(approval).toBeVisible();
  await expect(approval).toContainText('blue shoes');
  expect(await outText()).toBe('idle');
  await approval.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Searched.');
  expect(await outText()).toBe('searched:blue shoes');
  expect(JSON.parse(lastToolMessage())).toMatchObject({ typed: 'text box "Search"', submitted: true });
});

test('clicking a link by its text works, and it is asked about every time', async () => {
  await start([callsTool('browser-click', { text: 'More details' }), says(['Clicked.']), callsTool('browser-click', { text: 'Press me' }), says(['Pressed.'])]);
  await say('click it');
  await card('browser.click').getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Clicked.');
  expect(await outText()).toBe('clicked-more');
  await say('and the button');
  await expect(card('browser.click')).toBeVisible();
  await card('browser.click').getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Pressed.');
  expect(await outText()).toBe('pressed');
});

test('there is no way to allow clicking for good', async () => {
  await start([callsTool('browser-click', { text: 'Press me' }), says(['ok'])]);
  await say('click');
  await expect(card('browser.click')).toBeVisible();
  await expect(card('browser.click').getByRole('button', { name: 'Always allow' })).toHaveCount(0);
});

test('an ambiguous click is refused and the model is told which things matched', async () => {
  await start([callsTool('browser-click', { text: 'More' }), says(['Which one?'])]);
  await say('click more');
  await card('browser.click').getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Which one?');
  expect(lastToolMessage()).toMatch(/2 things match/);
  expect(await outText()).toBe('idle');
});

test('a password field is never typed into', async () => {
  await start([callsTool('browser-type', { field: 'Password', text: 'hunter2' }), says(['Could not.'])]);
  await say('log me in');
  await card('browser.type').getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Could not.');
  expect(lastToolMessage()).toMatch(/password/);
  const tab = (await views(mobius!.app))[0]!;
  expect(await runInPage(mobius!.app, tab.id, 'document.getElementById("pw").value')).toBe('');
});

test('declining leaves the page alone', async () => {
  await start([callsTool('browser-type', { field: 'Search', text: 'nope' }), says(['Understood.'])]);
  await say('type');
  await card('browser.type').getByRole('button', { name: 'Decline' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Understood.');
  expect(await outText()).toBe('idle');
});
