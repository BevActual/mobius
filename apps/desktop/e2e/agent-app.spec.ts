import { expect, test, type Locator } from '@playwright/test';
import { launch, startFixture, views, type Fixture, type Launched } from './harness';
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
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const list = (): Locator => shell().getByRole('complementary', { name: 'Conversation list' });
const say = async (text: string) => {
  // A message typed while the previous turn is still finishing is not sent, so wait for it to end.
  await expect(mobius!.shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};
const openApp = async (name: string) => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
  await shell().keyboard.press('Enter');
};
const visibleViews = async () => (await views(mobius!.app)).filter((v) => v.visible);

test('the launcher opens the Agent as a full app: the page is hidden and the side panel gives way', async () => {
  await start([]);
  await expect(shell().getByRole('complementary', { name: 'Agent' })).toBeVisible();
  expect(await visibleViews()).toHaveLength(1);
  await openApp('Agent');
  await expect(shell().getByText('Mobius · Agent')).toBeVisible();
  await expect(shell().getByRole('region', { name: 'Agent conversation' })).toBeVisible();
  await expect(shell().getByRole('complementary', { name: 'Agent' })).toHaveCount(0);
  await expect(shell().getByRole('textbox', { name: 'Address or question' })).toHaveCount(0);
  await expect.poll(async () => (await visibleViews()).length).toBe(0);
  await expect(shell().getByRole('button', { name: /Applications. Current: Agent/ })).toBeVisible();
});

test('going back to the Browser restores the page, the tabs and the side panel with the same conversation', async () => {
  await start([says(['Shared reply.'])]);
  await openApp('Agent');
  await say('Hello from the app');
  await expect(log().locator('.msg.assistant')).toHaveText('Shared reply.');
  await openApp('Browser');
  await expect(shell().getByRole('textbox', { name: 'Address or question' })).toBeVisible();
  await expect.poll(async () => (await visibleViews()).length).toBe(1);
  await expect(shell().getByRole('complementary', { name: 'Agent' })).toBeVisible();
  await expect(log().locator('.msg.user')).toHaveText('Hello from the app');
  await expect(log().locator('.msg.assistant')).toHaveText('Shared reply.');
});

test('the conversation list shows saved conversations, switches, starts new ones and deletes with a confirmation', async () => {
  await start([says(['Alpha reply.']), says(['Beta reply.'])]);
  await openApp('Agent');
  await say('Alpha topic');
  await expect(log().locator('.msg.assistant')).toHaveText('Alpha reply.');
  await list().getByRole('button', { name: 'New conversation' }).click();
  await expect(log().locator('.msg')).toHaveCount(0);
  await say('Beta topic');
  await expect(log().locator('.msg.assistant')).toHaveText('Beta reply.');
  const items = list().getByRole('listitem');
  await expect(items).toHaveText([/Beta topic/, /Alpha topic/]);
  await expect(items.first().getByRole('button', { name: /Beta topic/ })).toHaveAttribute('aria-current', 'true');
  await items.nth(1).getByRole('button', { name: /Alpha topic/ }).click();
  await expect(log().locator('.msg.user')).toHaveText('Alpha topic');
  await items.nth(1).getByRole('button', { name: 'Delete Alpha topic' }).click();
  await items.nth(1).getByRole('button', { name: 'Confirm delete' }).click();
  await expect(items).toHaveCount(1);
  await expect(log().locator('.msg.user')).toHaveText('Beta topic');
});

test('an approval can be answered in the full view, and the running tool is shown', async () => {
  await start([callsTool('clock-now'), says(['It is now.'])]);
  await openApp('Agent');
  await say('what time');
  const card = shell().getByRole('group', { name: 'Approval needed: clock.now' });
  await expect(card).toBeVisible();
  await expect(list().getByText('Needs you')).toBeVisible();
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('It is now.');
  await expect(list().getByText('Needs you')).toHaveCount(0);
});

test('settings opens over the Agent app and closes back to it', async () => {
  await start([]);
  await openApp('Agent');
  await shell().keyboard.press('Control+,');
  const page = shell().getByRole('region', { name: 'Settings' });
  await expect(page).toBeVisible();
  // Visible is not enough: the page has to be the thing on top, so a click lands on it and not on the chat behind.
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true }).click({ timeout: 3000 });
  await expect(page.getByRole('heading', { name: 'Browser', level: 2 })).toBeVisible();
  await shell().keyboard.press('Escape');
  await expect(page).toHaveCount(0);
  await expect(shell().getByRole('region', { name: 'Agent conversation' })).toBeVisible();
  expect(await visibleViews()).toHaveLength(0);
});

test('apps that are not built cannot be opened', async () => {
  await start([]);
  await openApp('Notes');
  await expect(shell().getByText('Mobius · Browser')).toBeVisible();
});

test('a conversation waiting for you is flagged in the list and on the app button even from the Browser', async () => {
  await start([callsTool('clock-now'), says(['Done.'])]);
  await say('what time');
  await expect(shell().getByRole('group', { name: 'Approval needed: clock.now' })).toBeVisible();
  await expect(shell().getByRole('status', { name: '1 waiting for you' })).toBeVisible();
  await openApp('Agent');
  await expect(list().getByText('Needs you')).toBeVisible();
  await list().getByRole('listitem').first().click();
  await shell().getByRole('group', { name: 'Approval needed: clock.now' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Done.');
  await expect(shell().getByRole('status', { name: /waiting for you/ })).toHaveCount(0);
});
