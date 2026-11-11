import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { interfaceZoom, launch, openSettings as openSettingsIn, startFixture, views, windowIsDark, type Fixture, type Launched } from './harness';
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

async function start(replies: ModelReply[], userData?: string): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' }, ...(userData ? { userData } : {}) });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const say = async (text: string) => {
  // A message typed while the previous turn is still finishing is not sent, so wait for it to end.
  await expect(mobius!.shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};
const openSettings = async () => {
  await openSettingsIn(shell());
  await expect(page()).toBeVisible();
};
const go = async (section: string, subpage?: string) => {
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
  if (subpage) await page().getByRole('tab', { name: subpage, exact: true }).click();
};
const visibleViews = async () => (await views(mobius!.app)).filter((v) => v.visible);
const allowAlways = async (tool: string) => shell().getByRole('group', { name: `Approval needed: ${tool}` }).getByRole('button', { name: 'Always allow' }).click();

test('Settings opens from the panel, hides the native page while open, and closes with Escape or the button', async () => {
  await start([]);
  expect(await visibleViews()).toHaveLength(1);
  await openSettings();
  await expect(page().getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  expect(await visibleViews()).toHaveLength(0);
  await shell().keyboard.press('Escape');
  await expect(page()).toHaveCount(0);
  await expect.poll(async () => (await visibleViews()).length).toBe(1);
  await openSettings();
  await page().getByRole('button', { name: 'Close settings' }).click();
  await expect(page()).toHaveCount(0);
  await shell().keyboard.press('Control+,');
  await expect(page()).toBeVisible();
});

test('the sections are the ones Mobius has, in order, and each shows its own page', async () => {
  await start([]);
  await openSettings();
  const nav = page().getByRole('navigation', { name: 'Settings sections' });
  // As in System Settings: sections with icons under headings, search at the top of the sidebar.
  await expect(nav.getByRole('group').locator('.settings-nav-heading')).toHaveText(['Mobius', 'Models', 'Safety', 'Apps', 'System']);
  await expect(nav.getByRole('button')).toHaveText(['General', 'Appearance', 'Notifications', 'Keyboard', 'Gateways', 'Models', 'Voice', 'Approvals and safety', 'Memory', 'Privacy', 'Browser', 'Conversations', 'Schedules', 'Extensions', 'Advanced', 'About']);
  await expect(nav.getByRole('searchbox', { name: 'Search settings' })).toBeVisible();
  await expect(page().getByRole('switch', { name: 'Reopen the last conversation' })).toBeVisible();
  await go('Approvals and safety');
  await expect(page().getByRole('tab')).toHaveText(['Approvals', 'Activity']);
  await go('Memory');
  await expect(page().getByRole('heading', { name: 'What Mobius remembers' })).toBeVisible();
  await go('Models');
  await expect(page().getByRole('tab')).toHaveText(['Defaults', 'This computer']);
  await expect(page().getByLabel('Server address')).toHaveValue(model!.url);
  await go('Keyboard');
  await expect(page().getByText('Ctrl+K')).toBeVisible();
});

test('search finds a setting by what it is about and jumps to it', async () => {
  await start([]);
  await openSettings();
  const search = page().getByRole('searchbox', { name: 'Search settings' });
  await search.fill('revoke');
  const hit = page().getByRole('button', { name: /Always allowed/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page().getByRole('tab', { name: 'Approvals', selected: true })).toBeVisible();
  await expect(page().locator('[data-setting="safety.approvals.always-allowed"]')).toHaveAttribute('data-highlight', 'true');
  await expect(search).toHaveValue('');
  await search.fill('qqqzzz');
  await expect(page().getByText('No settings match')).toBeVisible();
});

test('theme: choosing dark changes the whole app, and it is remembered', async () => {
  await start([]);
  await openSettings();
  await go('Appearance', 'Theme');
  await page().getByRole('radio', { name: 'Dark' }).check();
  // A hidden window never repaints, so its media query does not update; the main process is the source of truth.
  await expect.poll(() => windowIsDark(mobius!.app)).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(mobius!.userData, 'appearance.json'), 'utf8')).theme).toBe('dark');
  await page().getByRole('radio', { name: 'Light' }).check();
  // A hidden window never repaints, so its media query does not update; the main process is the source of truth.
  await expect.poll(() => windowIsDark(mobius!.app)).toBe(false);
});

test('zoom scales the window and the page stays exactly in its slot', async () => {
  await start([]);
  await openSettings();
  await go('Appearance', 'Typography');
  await page().getByRole('slider', { name: 'Interface zoom' }).fill('1.25');
  await expect.poll(() => interfaceZoom(mobius!.app)).toBeCloseTo(1.25, 2);
  await page().getByRole('button', { name: 'Close settings' }).click();
  await expect.poll(async () => (await visibleViews()).length).toBe(1);
  const slot = (await shell().getByTestId('surface-slot').boundingBox())!;
  await expect.poll(async () => {
    const view = (await visibleViews())[0]!;
    return [view.bounds.x - slot.x * 1.25, view.bounds.y - slot.y * 1.25, view.bounds.width - slot.width * 1.25, view.bounds.height - slot.height * 1.25].map((d) => Math.abs(d)).every((d) => d <= 3);
  }).toBe(true);
});

test('conversation text size changes only the conversation', async () => {
  await start([says(['Hello.'])]);
  await say('hi');
  await expect(log().locator('.msg.assistant')).toBeVisible();
  const before = await log().locator('.msg.assistant').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const chrome = await shell().locator('.chat-title, .strip-title').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await openSettings();
  await go('Appearance', 'Typography');
  await page().getByRole('slider', { name: 'Conversation text size' }).fill('1.4');
  await page().getByRole('button', { name: 'Close settings' }).click();
  // The change travels to the main process and back, so it lands a moment after the page closes.
  await expect.poll(() => log().locator('.msg.assistant').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(before * 1.3);
  expect(await shell().locator('.chat-title, .strip-title').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(chrome);
});

test('approvals: what you allowed for good is listed, and removing it makes the agent ask again', async () => {
  await start([callsTool('clock-now'), says(['one']), callsTool('clock-now'), says(['two'])]);
  await say('time');
  await allowAlways('clock.now');
  await expect(log().locator('.msg.assistant').last()).toHaveText('one');
  await openSettings();
  await go('Approvals and safety', 'Approvals');
  const list = page().getByRole('list', { name: 'Always allowed' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('clock.read');
  await list.getByRole('button', { name: /Remove/ }).click();
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await expect(page().getByText('Nothing is always allowed')).toBeVisible();
  await page().getByRole('button', { name: 'Close settings' }).click();
  await say('time again');
  await expect(shell().getByRole('group', { name: 'Approval needed: clock.now' })).toBeVisible();
});

test('activity lists what was asked, allowed and run, in plain words and never what was typed', async () => {
  await start([callsTool('clock-now'), says(['done'])]);
  await say('my secret request text');
  await shell().getByRole('group', { name: 'Approval needed: clock.now' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('done');
  await openSettings();
  await go('Approvals and safety', 'Activity');
  const rows = page().getByRole('list', { name: 'Activity log' });
  await expect(rows).toContainText('Asked you about clock.read');
  await expect(rows).toContainText('You allowed clock.read');
  await expect(rows).toContainText('Finished clock.now');
  expect(await rows.textContent()).not.toContain('secret');
});

test('browser: sites you allowed are listed by site and can be removed', async () => {
  await start([callsTool('browser-open', { url: fixture.origin + '/second' }), says(['opened'])]);
  await say('open it');
  await allowAlways('browser.open');
  await expect(log().locator('.msg.assistant')).toHaveText('opened');
  await openSettings();
  await go('Browser');
  const list = page().getByRole('list', { name: 'Allowed sites' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText(fixture.origin);
  await list.getByRole('button', { name: /Remove/ }).click();
  await expect(page().getByText('No sites are always allowed')).toBeVisible();
});

/** A new conversation, from the panel's All chats list. */
async function newConversation(): Promise<void> {
  await shell().getByRole('button', { name: 'All chats' }).click();
  await shell().getByRole('menu', { name: 'Conversations' }).getByRole('menuitem', { name: 'New conversation' }).click();
}

test('conversations are saved across restarts, listed, reopened and deleted', async () => {
  await start([says(['First answer.']), says(['Second answer.'])]);
  await say('Plan the harbour walk');
  await expect(log().locator('.msg.assistant')).toHaveText('First answer.');
  await newConversation();
  await expect(log().locator('.msg')).toHaveCount(0);
  await say('Order new nets');
  await expect(log().locator('.msg.assistant')).toHaveText('Second answer.');

  const userData = mobius!.userData;
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'fake-model' }, userData });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await expect(log().locator('.msg.user')).toHaveText('Order new nets');

  await openSettings();
  await go('Conversations');
  const list = page().getByRole('list', { name: 'Saved conversations' });
  await expect(list.getByRole('listitem')).toHaveText([/Order new nets/, /Plan the harbour walk/]);
  await list.getByRole('listitem').nth(1).getByRole('button', { name: 'Open' }).click();
  await expect(page()).toHaveCount(0);
  await expect(log().locator('.msg.user')).toHaveText('Plan the harbour walk');
  await expect(log().locator('.msg.assistant')).toHaveText('First answer.');

  await openSettings();
  await go('Conversations');
  const item = page().getByRole('list', { name: 'Saved conversations' }).getByRole('listitem').filter({ hasText: 'Order new nets' });
  await item.getByRole('button', { name: /Delete/ }).click();
  await expect(item.getByRole('button', { name: 'Confirm delete' })).toBeVisible();
  await item.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page().getByRole('list', { name: 'Saved conversations' }).getByRole('listitem')).toHaveCount(1);
});

test('the conversation menu in the panel switches between conversations and starts a new one', async () => {
  await start([says(['Alpha reply.']), says(['Beta reply.'])]);
  await say('Alpha topic');
  await expect(log().locator('.msg.assistant')).toHaveText('Alpha reply.');
  await newConversation();
  await say('Beta topic');
  await expect(log().locator('.msg.assistant')).toHaveText('Beta reply.');
  await shell().getByRole('button', { name: 'All chats' }).click();
  const menu = shell().getByRole('menu', { name: 'Conversations' });
  await expect(menu.getByRole('menuitem')).toContainText(['New conversation', 'Beta topic', 'Alpha topic']);
  await menu.getByRole('menuitem', { name: /Alpha topic/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(log().locator('.msg.user')).toHaveText('Alpha topic');
  await shell().getByRole('button', { name: 'All chats' }).click();
  await shell().keyboard.press('Escape');
  await expect(shell().getByRole('menu')).toHaveCount(0);
});

test('Advanced: the step limit is enforced', async () => {
  await start([callsTool('clock-now'), says(['unreachable']), callsTool('clock-now'), says(['never sent'])]);
  await say('time');
  await allowAlways('clock.now');
  await expect(log().locator('.msg.assistant')).toHaveText('unreachable');
  await newConversation();
  model!.requests.length = 0;
  await openSettings();
  await go('Advanced');
  await page().getByRole('spinbutton', { name: 'Steps per request' }).fill('1');
  await page().getByRole('button', { name: 'Save' }).click();
  await expect(page().getByText('Saved')).toBeVisible();
  await page().getByRole('button', { name: 'Close settings' }).click();
  await say('time again');
  await expect(log().getByRole('alert')).toContainText('too many steps');
});

test('Model: changing the model name is used by the next request', async () => {
  await start([says(['ok'])]);
  await openSettings();
  await go('Models');
  await page().getByLabel('Model', { exact: true }).fill('another-model');
  await page().getByRole('button', { name: 'Save' }).click();
  await page().getByRole('button', { name: 'Close settings' }).click();
  await say('hi');
  await expect(log().locator('.msg.assistant')).toHaveText('ok');
  expect(model!.requests[0]!.model).toBe('another-model');
});

test('About shows the versions, the core, and where the data is', async () => {
  await start([]);
  await openSettings();
  await go('About');
  await expect(page().getByText('Web engine')).toBeVisible();
  await expect(page().getByRole('row', { name: /Core/ })).toContainText(/\d+\.\d+\.\d+/);
  await expect(page().getByText(mobius!.userData, { exact: false })).toBeVisible();
  await expect(page().getByRole('button', { name: 'Open data folder' })).toBeVisible();
});

test('the approvals page lists everything that is asked about every time, including acting on web pages', async () => {
  await start([]);
  await openSettings();
  await go('Approvals and safety', 'Approvals');
  const row = page().locator('[data-setting="safety.approvals.each-time"]');
  await expect(row).toContainText('Running commands');
  await expect(row).toContainText('clicking or typing on a web page');
});

test('Voice: who listens and who speaks are saved, checked, and still there after a restart', async () => {
  await start([]);
  await openSettings();
  await go('Voice', 'Listening');
  // The chat model's server in these tests is a plain OpenAI-format one, so listening through it is offered.
  await expect(page().getByRole('radiogroup', { name: 'Listen with' }).getByRole('radio', { name: 'Chat server' })).toBeChecked();
  await page().getByRole('radiogroup', { name: 'Listen with' }).getByRole('radio', { name: 'This computer' }).check();
  const address = page().getByRole('textbox', { name: 'Listening server address' });
  await address.fill('ftp://nope');
  await expect(page().getByRole('alert')).toContainText('http:// or https://');
  await address.fill('http://127.0.0.1:9/v1');
  await page().getByRole('button', { name: 'Save listening server address' }).click();
  // Not running: the test says so, with the address.
  await page().getByRole('button', { name: 'Try listening' }).click();
  await expect(page().getByRole('alert')).toContainText('127.0.0.1:9');
  await go('Voice', 'Speaking');
  await page().getByRole('radiogroup', { name: 'Speak with' }).getByRole('radio', { name: 'ElevenLabs' }).check();
  await expect(page().getByText('ElevenLabs needs its key, added in Gateways.')).toBeVisible();
  await page().getByRole('button', { name: 'Try speaking' }).click();
  await expect(page().getByRole('alert')).toContainText('Gateways');
  await page().getByRole('textbox', { name: 'Voice', exact: true }).fill('Rachel');
  await page().getByRole('button', { name: 'Save voice', exact: true }).click();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(mobius!.userData, 'preferences.json'), 'utf8')).speakVoice).toBe('Rachel');

  const userData = mobius!.userData;
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'fake-model' }, userData });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openSettings();
  await go('Voice', 'Listening');
  await expect(page().getByRole('radiogroup', { name: 'Listen with' }).getByRole('radio', { name: 'This computer' })).toBeChecked();
  await expect(page().getByRole('textbox', { name: 'Listening server address' })).toHaveValue('http://127.0.0.1:9/v1');
  await go('Voice', 'Speaking');
  await expect(page().getByRole('radiogroup', { name: 'Speak with' }).getByRole('radio', { name: 'ElevenLabs' })).toBeChecked();
  await expect(page().getByRole('textbox', { name: 'Voice', exact: true })).toHaveValue('Rachel');
});

test('search at the top of the sidebar finds settings by their old names too, and Extensions opens its app', async () => {
  await start([]);
  await openSettings();
  const search = page().getByRole('navigation', { name: 'Settings sections' }).getByRole('searchbox', { name: 'Search settings' });
  await search.fill('providers');
  await expect(page().getByRole('list', { name: 'Search results' })).toContainText('Gateways');
  await search.fill('kokoro');
  await page().getByRole('button', { name: /Voice model/ }).click();
  await expect(page().getByRole('tab', { name: 'Speaking', selected: true })).toBeVisible();
  await go('Extensions');
  await page().getByRole('button', { name: 'Open Extensions' }).click();
  await expect(page()).toHaveCount(0);
  await expect(shell().locator('.app')).toHaveAttribute('data-app', 'skills');
});
