import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { choose, interfaceZoom, launch, openSettings as openSettingsIn, startFixture, views, windowIsDark, type Fixture, type Launched } from './harness';
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
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
  if (subpage) await page().locator(`.settings-group[aria-label="${subpage}"]`).scrollIntoViewIfNeeded();
};
const visibleViews = async () => (await views(mobius!.app)).filter((v) => v.visible);
const allowAlways = async (tool: string) => shell().getByRole('group', { name: `Approval needed: ${tool}` }).getByRole('button', { name: 'Always allow' }).click();

test('Settings opens as an app: its sections in the sidebar, the page name in the title row, the native page hidden, and Escape leaves', async () => {
  await start([]);
  expect(await visibleViews()).toHaveLength(1);
  await openSettings();
  await expect(shell().locator('.strip-title')).toHaveText('Settings');
  await expect(shell().locator('.toolbar-sub')).toHaveText('General');
  // One left panel: Settings' search and sections, not the last app's list beside them.
  await expect(shell().locator('.ui-dock[data-dock="left"]').getByRole('region', { name: 'Sections', exact: true }).getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(shell().getByRole('complementary', { name: 'Tabs' })).toHaveCount(0);
  await expect(page().getByRole('button', { name: 'Close settings' })).toHaveCount(0);
  expect(await visibleViews()).toHaveLength(0);
  // The sections are always there, as in System Settings: no Hide button, and Ctrl+\ leaves them.
  const sections = () => shell().getByRole('navigation', { name: 'Settings sections' });
  await expect(shell().getByRole('button', { name: 'Hide Sections' })).toHaveCount(0);
  await shell().keyboard.press('Control+Backslash');
  await expect(sections()).toBeVisible();
  await shell().keyboard.press('Escape');
  await expect(page()).toHaveCount(0);
  await expect.poll(async () => (await visibleViews()).length).toBe(1);
  await openSettings();
  await shell().keyboard.press('Escape');
  await expect(page()).toHaveCount(0);
  await shell().keyboard.press('Control+,');
  await expect(page()).toBeVisible();
});

test('an app chosen from the launcher while Settings is open is the one that shows', async () => {
  await start([]);
  await openSettings();
  await go('Keyboard');
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Tasks');
  await shell().keyboard.press('Enter');
  await expect(page()).toHaveCount(0);
  await expect(shell().locator('.app')).toHaveAttribute('data-app', 'tasks');
  await expect(shell().locator('.strip-title')).not.toHaveText('Keyboard');
});

test('the sections are the ones Mobius has, in order, and each shows its own page', async () => {
  await start([]);
  await openSettings();
  const nav = shell().getByRole('navigation', { name: 'Settings sections' });
  // As in System Settings: sections with icons under headings, search at the top of the sidebar.
  await expect(nav.locator('.side-title')).toHaveText(['Connections', 'Mobius', 'Models', 'Safety', 'Apps', 'System']);
  await expect(nav.getByRole('button')).toHaveText(['Accounts', 'Gateways', 'General', 'Appearance', 'Notifications', 'Keyboard', 'Conversations', 'Schedules', 'Models', 'Usage', 'Approvals and safety', 'Memory', 'Privacy', 'Browser', 'Mail', 'Calendar', 'Contacts', 'Messages', 'Store', 'Advanced', 'About']);
  await expect(shell().getByRole('complementary', { name: 'Sections' }).getByRole('searchbox', { name: 'Search settings' })).toBeVisible();
  await expect(page().getByRole('switch', { name: 'Reopen the last conversation' })).toBeVisible();
  await go('Approvals and safety');
  // A section's pages are its groups, one card each, all on the one page.
  await expect.poll(() => page().locator('.settings-group').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Approvals', 'Activity']);
  await go('Memory');
  await expect(page().getByRole('heading', { name: 'What Mobius remembers' })).toBeVisible();
  await go('Models');
  await expect.poll(() => page().locator('.settings-group').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Capabilities', 'Listening', 'Speaking', 'This computer']);
  // The chat model is a pop-up of what the gateways offer; the server's address is in Gateways, Custom server.
  await expect(page().getByRole('combobox', { name: 'Chat model' })).toBeVisible();
  await go('Gateways');
  await page().getByRole('button', { name: 'Custom server…' }).click();
  await expect(page().getByLabel('Server address')).toHaveValue(model!.url);
  await go('Keyboard');
  await expect(page().getByText('Ctrl+K')).toBeVisible();
});

test('search finds a setting by what it is about and jumps to it', async () => {
  await start([]);
  await openSettings();
  const search = shell().getByRole('searchbox', { name: 'Search settings' });
  await search.fill('revoke');
  const hit = page().getByRole('button', { name: /Always allowed/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page().locator('.settings-group[aria-label="Approvals"]')).toBeVisible();
  await expect(page().locator('[data-setting="safety.approvals.always-allowed"]')).toHaveAttribute('data-highlight', 'true');
  await expect(search).toHaveValue('');
  await search.fill('qqqzzz');
  await expect(page().getByText('No settings match')).toBeVisible();
});

test('the arrow keys move through search results, and each section opens at its top', async () => {
  await start([]);
  await openSettings();
  const search = shell().getByRole('searchbox', { name: 'Search settings' });
  await search.fill('zoom');
  const results = page().getByRole('list', { name: 'Search results' }).getByRole('button');
  await expect(results.first()).toBeVisible();
  await search.press('ArrowDown');
  await expect(results.first()).toBeFocused();
  await shell().keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  await search.press('ArrowDown');
  await shell().keyboard.press('Enter');
  await expect(page().locator('[data-highlight="true"]')).toBeInViewport();
  // Scrolled down one section, the next one starts at its top, not where the last one was.
  const content = page().locator('.settings-content');
  await content.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await go('Advanced');
  await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(0);
});

test('Keyboard lists the keys Mobius keeps, and Little Mobius no longer shares Ctrl+Shift+M with showing Mobius', async () => {
  await start([]);
  await openSettings();
  await go('Keyboard');
  await expect(page().getByRole('button', { name: 'Show or hide Mobius beside the work: Ctrl+Shift+M, cannot be changed' })).toBeDisabled();
  await expect(page().getByTestId('keys-littleMobius')).toHaveText('Not set');
  // A shortcut can't take one of them.
  await page().getByRole('button', { name: 'Change Open or close Little Mobius' }).click();
  await shell().keyboard.press('Control+Shift+M');
  await expect(page().getByRole('alert')).toContainText('Mobius keeps these keys');
  await expect(page().getByTestId('keys-littleMobius')).toHaveText('Not set');
});

test('Back and Forward go between the sections visited, and Escape while typing leaves the field, not Settings', async () => {
  await start([]);
  await openSettings();
  const tools = shell().getByRole('group', { name: 'Settings', exact: true });
  const back = tools.getByRole('button', { name: 'Back' });
  const forward = tools.getByRole('button', { name: 'Forward' });
  const title = shell().locator('.toolbar-sub');
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await go('Appearance');
  await go('Advanced');
  await expect(title).toHaveText('Advanced');
  await back.click();
  await expect(title).toHaveText('Appearance');
  await shell().keyboard.press('Alt+ArrowLeft');
  await expect(title).toHaveText('General');
  await expect(back).toBeDisabled();
  await forward.click();
  await expect(title).toHaveText('Appearance');
  // A new section after going back drops what was ahead, as in a browser.
  await go('Keyboard');
  await expect(forward).toBeDisabled();
  // Typing in a field, Escape leaves the field and Settings stays; the next Escape closes it.
  await go('Advanced');
  const steps = page().getByRole('spinbutton', { name: 'Steps per request' });
  await steps.click();
  await shell().keyboard.press('Escape');
  await expect(page()).toBeVisible();
  await expect(steps).not.toBeFocused();
  await shell().keyboard.press('Escape');
  await expect(page()).toHaveCount(0);
});

test('theme: choosing dark changes the whole app, and it is remembered', async () => {
  await start([]);
  await openSettings();
  await go('Appearance', 'Theme');
  await page().getByRole('radio', { name: 'Dark', exact: true }).check();
  // A hidden window never repaints, so its media query does not update; the main process is the source of truth.
  await expect.poll(() => windowIsDark(mobius!.app)).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(mobius!.userData, 'appearance.json'), 'utf8')).theme).toBe('dark');
  await page().getByRole('radio', { name: 'Light', exact: true }).check();
  // A hidden window never repaints, so its media query does not update; the main process is the source of truth.
  await expect.poll(() => windowIsDark(mobius!.app)).toBe(false);
});

test('zoom scales the window and the page stays exactly in its slot', async () => {
  await start([]);
  await openSettings();
  await go('Appearance', 'Typography');
  await page().getByRole('slider', { name: 'Interface zoom' }).fill('1.25');
  await expect.poll(() => interfaceZoom(mobius!.app)).toBeCloseTo(1.25, 2);
  await shell().keyboard.press('Escape');
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
  await shell().keyboard.press('Escape');
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
  await shell().keyboard.press('Escape');
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
  await shell().getByRole('menu', { name: 'Conversations' }).getByRole('menuitem', { name: 'New chat' }).click();
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
  await expect(menu.getByRole('menuitem')).toContainText(['New chat', 'Beta topic', 'Alpha topic']);
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
  await page().getByRole('spinbutton', { name: 'Steps per request' }).press('Enter');
  await expect(page().getByText('Saved')).toBeVisible();
  // The first Escape leaves the field, the second closes Settings.
  await shell().keyboard.press('Escape');
  await shell().keyboard.press('Escape');
  await expect(page()).toHaveCount(0);
  await say('time again');
  await expect(log().getByRole('alert')).toContainText('too many steps');
});

test('Model: changing the model name is used by the next request', async () => {
  await start([says(['ok'])]);
  await openSettings();
  await go('Gateways');
  await page().getByRole('button', { name: 'Custom server…' }).click();
  await page().getByLabel('Model', { exact: true }).fill('another-model');
  await page().getByRole('button', { name: 'Save' }).click();
  await shell().keyboard.press('Escape');
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

test('Models, Listening and Speaking (Voice folded in): who listens and who speaks are saved, checked, and still there after a restart', async () => {
  await start([]);
  await openSettings();
  await go('Models', 'Listening');
  // The chat model's server in these tests is a plain OpenAI-format one, so listening through it is offered.
  await expect(page().getByRole('combobox', { name: 'Listen with' })).toHaveText('Chat server');
  // Whisper on this computer: the one-time download and the accuracy, and no speech model to name.
  await choose(page(), 'Listen with', 'This computer (free)');
  await expect(page().getByTestId('voice-device')).toBeVisible();
  await expect(page().getByRole('combobox', { name: 'Accuracy' })).toHaveText('Quick');
  await expect(page().getByRole('textbox', { name: 'Speech model' })).toHaveCount(0);
  await choose(page(), 'Listen with', 'Speech server on this computer');
  const address = page().getByRole('textbox', { name: 'Listening server address' });
  await address.fill('ftp://nope');
  await expect(page().getByRole('alert')).toContainText('http:// or https://');
  await address.fill('http://127.0.0.1:9/v1');
  await address.press('Enter');
  // Not running: the test says so, with the address.
  await page().getByRole('button', { name: 'Try listening' }).click();
  await expect(page().locator('.settings-group[aria-label="Listening"]').getByRole('alert')).toContainText('127.0.0.1:9');
  await go('Models', 'Speaking');
  await choose(page(), 'Speak with', 'ElevenLabs');
  await expect(page().getByText('ElevenLabs needs its key, added in Gateways.')).toBeVisible();
  await page().getByRole('button', { name: 'Try speaking' }).click();
  await expect(page().locator('.settings-group[aria-label="Speaking"]').getByRole('alert')).toContainText('Gateways');
  // The field saves itself when you leave it.
  await page().getByRole('textbox', { name: 'Voice', exact: true }).fill('Rachel');
  await page().getByRole('textbox', { name: 'Voice', exact: true }).blur();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(mobius!.userData, 'preferences.json'), 'utf8')).speakVoice).toBe('Rachel');

  const userData = mobius!.userData;
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'fake-model' }, userData });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openSettings();
  await go('Models', 'Listening');
  await expect(page().getByRole('combobox', { name: 'Listen with' })).toHaveText('Speech server on this computer');
  await expect(page().getByRole('textbox', { name: 'Listening server address' })).toHaveValue('http://127.0.0.1:9/v1');
  await go('Models', 'Speaking');
  await expect(page().getByRole('combobox', { name: 'Speak with' })).toHaveText('ElevenLabs');
  await expect(page().getByRole('textbox', { name: 'Voice', exact: true })).toHaveValue('Rachel');
});

test('search at the top of the sidebar finds settings by their old names too', async () => {
  await start([]);
  await openSettings();
  const search = shell().getByRole('searchbox', { name: 'Search settings' });
  await search.fill('providers');
  await expect(page().getByRole('list', { name: 'Search results' })).toContainText('Gateways');
  await search.fill('kokoro');
  await page().getByRole('button', { name: /Voice model/ }).click();
  await expect(page().locator('.settings-group[aria-label="Speaking"]')).toBeVisible();
});

test('Software Update: About shows the version and says the updater is off in this build; the switch is kept', { tag: '@shell', annotation: { type: 'needs the shell', description: "Software Update is the shell's" } }, async () => {
  await start([]);
  await openSettings();
  await go('About');
  const status = page().locator('[data-update-state]');
  await expect(status).toHaveAttribute('data-update-state', 'off');
  await expect(status).toContainText('off');
  await expect(page().getByRole('button', { name: 'Check for Updates' })).toBeDisabled();
  const auto = page().getByRole('switch', { name: 'Automatically install updates' });
  await expect(auto).toBeChecked();
  await auto.uncheck();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(mobius!.userData, 'preferences.json'), 'utf8')).autoUpdate).toBe(false);
  // Nothing in the toolbar: there is no update waiting.
  await expect(shell().getByRole('button', { name: /Restart to install/ })).toHaveCount(0);
});

test('Usage counts a model call, groups it by model and app, and clears after asking', async () => {
  await start([says(['ok'])]);
  await say('hello');
  await expect(log().locator('.msg.assistant')).toHaveText('ok');
  await openSettings();
  await go('Usage');
  const totals = page().getByRole('region', { name: 'Totals' });
  await expect(totals).toContainText(/Requests\s*1(?!\d)/, { timeout: 10_000 });
  await expect(page().getByRole('table', { name: 'Usage by model' })).toContainText('fake-model');
  await page().getByRole('tab', { name: 'App' }).click();
  await expect(page().getByRole('table', { name: 'Usage by app' }).getByRole('row')).toHaveCount(2);
  await expect(page().getByRole('button', { name: 'Copy as CSV' })).toBeEnabled();
  await page().getByRole('button', { name: 'Clear Usage…' }).click();
  await page().getByRole('group', { name: 'Confirm clearing usage' }).getByRole('button', { name: 'Clear All Usage' }).click();
  await expect(page().getByText('Nothing used in this period.').first()).toBeVisible();
});

test('Accounts lists one row per account, opens its own page, and Add Account offers each provider', async () => {
  await start([]);
  // An account signed in to once and switched off for every app stays listed, as Internet Accounts keeps it.
  await shell().evaluate(() => window.mobius.accounts!.remember({ provider: 'google', email: 'ana@gmail.com' }));
  await openSettings();
  await go('Accounts');
  await expect(shell().locator('.toolbar-sub')).toHaveText('Accounts');
  const list = page().getByRole('list', { name: 'Accounts' });
  const ana = list.getByRole('button', { name: /ana@gmail\.com/ });
  await expect(ana).toContainText('Not on for any app');
  // Model plans and connectors each have their own card below.
  await expect(page().getByRole('heading', { name: 'Model Plans' })).toBeVisible();
  await expect(page().getByRole('list', { name: 'Model plans' })).toBeVisible();
  await expect(page().getByRole('list', { name: 'Connectors' })).toBeVisible();
  await expect(page().getByRole('button', { name: 'Find more in Store' })).toBeVisible();

  await ana.click();
  await expect(page().locator('.settings-crumb')).toHaveText('Connections › Accounts › ana@gmail.com');
  await expect(page().getByRole('heading', { name: 'ana@gmail.com' })).toBeVisible();
  await expect(page().getByText('Google · Connected')).toBeVisible();
  const apps = page().getByRole('list', { name: 'Apps' });
  await expect(apps.getByRole('switch')).toHaveCount(3);
  for (const app of ['Mail', 'Calendar', 'Files']) await expect(apps.getByRole('switch', { name: app })).not.toBeChecked();
  // An account's page is a step: Back returns to the list, Forward to the account.
  await shell().keyboard.press('Alt+ArrowLeft');
  await expect(ana).toBeVisible();
  await shell().keyboard.press('Alt+ArrowRight');
  await expect(page().getByRole('heading', { name: 'ana@gmail.com' })).toBeVisible();

  // Remove Account… asks once more, then the account is gone.
  await page().getByRole('button', { name: 'Remove Account…' }).click();
  const sheet = shell().getByRole('alertdialog', { name: 'Remove ana@gmail.com' });
  await expect(sheet).toContainText('stay with Google');
  await sheet.getByRole('button', { name: 'Remove' }).click();
  await expect(list.getByRole('button', { name: /ana@gmail\.com/ })).toHaveCount(0);
  expect(await shell().evaluate(() => window.mobius.accounts!.list())).toEqual([]);

  await list.getByRole('button', { name: 'Add Account…' }).click();
  const add = shell().getByRole('dialog', { name: 'Add Account' });
  // Each row's name, without its mark's letter.
  await expect(add.getByRole('list', { name: 'Providers' }).locator('.conn-account')).toHaveText(['Google', 'Microsoft', 'iCloud', 'Fastmail', 'Slack', 'Dropbox', 'Other Account…']);
  await add.getByRole('button', { name: 'Other Account…' }).click();
  await expect(add.getByRole('list', { name: 'Kinds of account' }).locator('.conn-account')).toHaveText(['Mail account', 'CalDAV calendar', 'Calendar subscription', 'CardDAV contacts', 'WebDAV or S3 drive', 'Matrix', 'Telegram']);
  await add.getByRole('button', { name: 'Back' }).click();
  await expect(add.getByRole('list', { name: 'Providers' })).toBeVisible();
  await add.getByRole('button', { name: 'Other Account…' }).click();
  await add.getByRole('button', { name: 'CardDAV contacts' }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Contacts');
});

test('the morning brief: Write one now asks in Ask mode, and it lands in the Inbox written, with Play and Done', async () => {
  await start([says(['## Today\n\n- Two tasks due, one overdue\n- Dentist at 15:00'])]);
  await openSettings();
  await go('Schedules', 'Check-ins');
  const brief = page().getByRole('switch', { name: 'Morning brief' });
  // The tests start with it off, so nothing is asked on its own.
  await expect(brief).not.toBeChecked();
  await page().getByRole('button', { name: 'Write one now' }).click();
  await expect(page().getByRole('status').filter({ hasText: 'It will be in your Inbox' })).toBeVisible();
  // It only reads, and only in the apps it looks at.
  await expect.poll(() => model!.requests.length).toBe(1);
  const request = model!.requests[0]!;
  expect(JSON.stringify(request.messages)).toContain('Give me my morning brief for');
  const tools = ((request.tools ?? []) as Array<{ function?: { name?: string }; name?: string }>).map((t) => t.function?.name ?? t.name ?? '');
  expect(tools.length).toBeGreaterThan(0);
  // Beside Mobius's own (its to-do list, asking you), only those apps' tools, and none that change them.
  const apps = tools.filter((t) => !['todo-write', 'ask-person'].includes(t));
  expect(apps.length).toBeGreaterThan(0);
  expect(apps.every((t) => /^(tasks|calendar|mail)-/.test(t))).toBe(true);
  expect(apps.some((t) => /add|delete|send|draft|move/.test(t))).toBe(false);

  await shell().keyboard.press('Escape');
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
  await shell().keyboard.press('Enter');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  await expect(inbox.getByRole('button', { name: 'Open Morning brief' })).toBeVisible();
  await expect(inbox.getByRole('list', { name: 'Morning brief, as written' }).getByRole('listitem')).toHaveText(['Today', 'Two tasks due, one overdue', 'Dentist at 15:00']);
  // Nothing speaks until Play; with no voice chosen, it says so and how to set one up.
  await inbox.getByRole('button', { name: 'Play Morning brief' }).click();
  await expect(inbox.getByRole('alert')).toBeVisible();
  await inbox.getByRole('button', { name: 'Done with Morning brief' }).click();
  await expect(inbox.getByRole('button', { name: 'Open Morning brief' })).toHaveCount(0);
});
