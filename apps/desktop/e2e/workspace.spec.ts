import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture, type Fixture, type Launched, removeTestData, turnEnded } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-workspace-'));
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
const rail = (): Locator => shell().getByRole('navigation', { name: 'Apps' });
const railButton = (name: string): Locator => rail().getByRole('button', { name, exact: true });
// The sidebar belongs to the open app; its head switches the same column to the list of apps.
// Waits for the full sidebar to show a face first: just after start it can still be settling.
const showApps = async (): Promise<void> => { await expect(rail()).toHaveAttribute('data-face', /^(app|apps|mobius)$/); if ((await rail().getAttribute('data-face')) !== 'apps') await rail().locator('[data-app-switcher]').click(); await expect(rail()).toHaveAttribute('data-face', 'apps'); };
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}
const seed = () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Home'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Home', 'Garden.md'), '# Garden\nPlant the tulips before the frost.\n');
  fs.mkdirSync(path.join(userData, 'workspace', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), '# Inbox\n\n- [ ] Buy tulip bulbs\n- [ ] Call the bank\n');
};

test('the rail opens every app, shows where you are, and holds Settings', async () => {
  await start();
  await showApps();
  await expect(railButton('Browser')).toHaveAttribute('aria-current', 'page');
  for (const [name, view] of [['Tasks', '.tasks-page'], ['Notes', '[aria-label="Notes sidebar"]'], ['Search', '.search-page'], ['Agent', '.chat.full']] as const) {
    await showApps();
    await railButton(name).click();
    await expect(shell().locator(view)).toBeVisible();
    await showApps();
    await expect(railButton(name)).toHaveAttribute('aria-current', 'page');
  }
  await showApps();
  await expect(rail().locator('[aria-current="page"]')).toHaveCount(1);
  await railButton('Settings').click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toBeVisible();
  // The foot holds only the profile: Settings is one of Mobius's apps in the switcher, and closes from there too.
  await expect(rail().locator('.rail-end').getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await showApps();
  await railButton('Settings').click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toHaveCount(0);
});

test('Search finds notes, tasks and pages in one place and opens each in its own app', async () => {
  seed();
  await start();
  await showApps();
  await railButton('Search').click();
  const page = shell().locator('.search-page');
  const box = page.getByRole('searchbox', { name: 'Search everything' });
  expect(await box.evaluate((el) => el === document.activeElement)).toBe(true);
  // Nothing typed: the latest things, from every app.
  await expect(page.getByRole('list', { name: 'Recent' })).toContainText('Garden');
  await box.fill('tulip');
  const results = page.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('button')).toHaveCount(2);
  await expect(results).toContainText('Notes › Home');
  await expect(results).toContainText('Tasks › Inbox');
  await page.getByRole('radio', { name: 'Tasks' }).click();
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Buy tulip bulbs/ }).click();
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('aria-current', 'page');
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');

  await showApps();
  await railButton('Search').click();
  await page.getByRole('radio', { name: 'All' }).click();
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('frost');
  await page.getByRole('list', { name: 'Results' }).getByRole('button', { name: /Garden/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Note text' })).toContainText('tulips before the frost');
});

test('asking from Search hands the question to the agent', async () => {
  await start([says(['Here is what I found.'])]);
  await showApps();
  await railButton('Search').click();
  await shell().getByRole('searchbox', { name: 'Search everything' }).fill('what did I plan for the garden');
  await shell().getByRole('button', { name: /Ask Mobius/ }).click();
  await showApps();
  await expect(railButton('Agent')).toHaveAttribute('aria-current', 'page');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Here is what I found.');
});

test('while the agent works the composer says what it is doing, the app it works in glows, and a change elsewhere leaves a dot', async () => {
  await start([callsTool('tasks-add', { list: 'Inbox', text: 'Water the plants' }), says(['Added.'])]);
  await turnEnded(composer());
  await composer().fill('Remind me to water the plants');
  await composer().press('Enter');
  const activity = shell().getByRole('status', { name: 'Agent activity' });
  await expect(activity).toHaveText('Waiting for you to allow it');
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('data-working', 'true');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added.');
  // The panel says which apps Mobius has worked in during this conversation.
  await expect(shell().locator('.chat-sees')).toHaveText('Sees: Tasks');
  await expect(shell().locator('.msg-sources').last()).toHaveText('Based on Tasks');
  await expect(activity).toHaveCount(0);
  await showApps();
  await expect(railButton('Tasks')).not.toHaveAttribute('data-working');
  // The agent changed Tasks while you were in the Browser: a dot until you look.
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('data-changed', 'true');
  await showApps();
  await railButton('Tasks').click();
  await expect(shell().locator('.strip-title')).toHaveText('Today');
  await showApps();
  await railButton('Browser').click();
  await showApps();
  await expect(railButton('Tasks')).not.toHaveAttribute('data-changed');
});

test('the app hub shows every app with what is happening in it, starts new things, and lists the apps to come', async () => {
  seed();
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), `# Inbox\n\n- [ ] Buy tulip bulbs (due 2001-01-01)\n`);
  await start();
  // All apps is the last row of the switcher.
  await showApps();
  const opener = shell().getByRole('button', { name: /^Applications/ });
  await showApps();
  await opener.click();
  const hub = shell().getByRole('dialog', { name: 'Applications' });
  await expect(hub).toBeVisible();
  const apps = hub.getByRole('region', { name: 'Apps' });
  await expect(apps.getByRole('button', { name: 'Notes, 1 page' })).toBeVisible();
  await expect(apps.getByRole('button', { name: /^Tasks, 1 due today/ })).toBeVisible();
  await expect(apps.getByRole('button', { name: /^Browser, 1 tab open/ })).toHaveAttribute('aria-current', 'page');
  // Apps sit in groups by what they are for.
  await expect(apps.getByRole('group', { name: 'Write and plan' }).getByRole('button', { name: 'Notes, 1 page' })).toBeVisible();
  await expect(apps.getByRole('group', { name: 'Review' }).getByRole('button', { name: /^Review/ })).toBeEnabled();
  // Typing narrows it; Enter opens the first app that matches.
  await hub.getByRole('searchbox', { name: 'Find apps' }).fill('tas');
  await expect(apps.getByRole('button')).toHaveCount(1);
  await hub.getByRole('searchbox', { name: 'Find apps' }).press('Enter');
  await expect(hub).toBeHidden();
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('aria-current', 'page');

  // Start something new from anywhere: a task lands in the Inbox, with the cursor in the new-task box.
  await showApps();
  await opener.click();
  await hub.getByRole('region', { name: 'Start something' }).getByRole('button', { name: 'New task' }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  const field = shell().getByRole('textbox', { name: 'New task', exact: true });
  await expect.poll(() => field.evaluate((el) => el === document.activeElement)).toBe(true);
  await showApps();
  await opener.click();
  await hub.getByRole('button', { name: 'New note' }).click();
  await showApps();
  await expect(railButton('Notes')).toHaveAttribute('aria-current', 'page');
  await expect(shell().getByRole('textbox', { name: 'Note text' }).locator('h1')).toHaveText('Untitled');
  await showApps();
  await opener.click();
  await shell().keyboard.press('Escape');
  await expect(hub).toBeHidden();
});

test('the full sidebar is the default: it belongs to the open app, with the apps one press away in its head; folding it to the rail is remembered', async () => {
  seed();
  await start();
  await expect(rail()).toHaveAttribute('data-expanded', 'true');
  // The Create button follows the app you are in.
  await expect(railButton('Create')).toHaveAttribute('title', 'New tab');
  await expect(rail().getByRole('complementary', { name: 'Browser sidebar' })).toBeVisible();
  await expect(shell().locator('.body > .dock.left')).toHaveCount(0);
  await showApps();
  await railButton('Tasks').click();
  // In Tasks, New is the first row of the app's own lists (and adding a task the first row of a list), so the
  // sidebar's own Create button gives way.
  const lists = rail().getByRole('navigation', { name: 'Lists' });
  await expect(lists).toBeVisible();
  await expect(railButton('Create')).toHaveCount(0);
  await expect(lists.getByRole('button', { name: 'New list' })).toBeVisible();
  await lists.getByRole('button', { name: /^Inbox/ }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  await expect(shell().getByRole('textbox', { name: 'New task', exact: true })).toHaveAttribute('placeholder', 'Add to Inbox');

  await railButton('Collapse sidebar').click();
  await expect(rail()).not.toHaveAttribute('data-expanded');
  await expect(shell().locator('.body > .dock.left')).toHaveCount(1);
  // Remembered after a restart.
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await expect(rail()).not.toHaveAttribute('data-expanded');
  await railButton('Expand sidebar').click();
  await expect(rail()).toHaveAttribute('data-expanded', 'true');
});

test('Mobius can sit in the sidebar: the conversation takes the column, the panel beside the page goes, and it comes back', async () => {
  await start();
  const face = rail().locator('[data-mobius-face]');
  await expect(shell().locator('.dock.right')).toHaveCount(1);
  await face.click();
  await expect(rail()).toHaveAttribute('data-face', 'mobius');
  await expect(shell().locator('.dock.right')).toHaveCount(0);
  await expect(rail().getByRole('textbox', { name: 'Message Mobius' })).toBeVisible();
  // The browser's address stays with it.
  await expect(rail().getByRole('textbox', { name: 'Address or question' })).toBeVisible();
  // The same button gives the sidebar back to the app; Mobius stays out of the way.
  await face.click();
  await expect(rail()).toHaveAttribute('data-face', 'app');
  await expect(shell().locator('.dock.right')).toHaveCount(0);
  await face.click();
  await rail().getByRole('button', { name: 'Show beside' }).click();
  await expect(shell().locator('.dock.right')).toHaveCount(1);
  await expect(rail()).toHaveAttribute('data-face', 'app');
});

test('a narrow window folds the sidebar to the rail without changing the choice', async () => {
  await start();
  await expect(rail()).toHaveAttribute('data-expanded', 'true');
  await resizeWindow(mobius!.app, 900, 700);
  await expect(rail()).not.toHaveAttribute('data-expanded');
  await railButton('Expand sidebar').click();
  await expect(rail()).toHaveAttribute('data-expanded', 'true');
  await resizeWindow(mobius!.app, 1300, 800);
  await expect(rail()).toHaveAttribute('data-expanded', 'true');
  expect((await shell().evaluate(() => window.mobius.appearance.get())).navigation).toBe('sidebar');
});

test('with the agent panel put away, asking from the toolbar opens it with the answer', async () => {
  await start([says(['That page is the fixture home.'])]);
  await shell().getByRole('button', { name: 'Show agent' }).click();
  await expect(shell().getByRole('complementary', { name: 'Agent' })).toHaveCount(0);
  const ask = shell().getByRole('textbox', { name: 'Ask Mobius' });
  await expect(ask).toHaveAttribute('placeholder', 'Ask about this page');
  await ask.fill('What is this page?');
  await ask.press('Enter');
  await expect(shell().getByRole('complementary', { name: 'Agent' })).toBeVisible();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('That page is the fixture home.');
  await expect(ask).toHaveCount(0);
});

test('Mobius’s own apps sit in the switcher: Bots and Activity open their views of the Agent app, and Settings opens Settings', async () => {
  await start();
  await showApps();
  const own = rail().getByRole('region', { name: 'Mobius’s apps' });
  await own.getByRole('button', { name: 'Bots', exact: true }).click();
  const side = shell().getByRole('complementary', { name: 'Conversation list' });
  await expect(side.getByRole('tab', { name: 'Bots' })).toHaveAttribute('aria-selected', 'true');
  await expect(rail().locator('[data-app-switcher]')).toHaveAttribute('aria-label', 'Switch app. Current: Bots');
  await showApps();
  // Only Bots is where you are: not Agent too.
  await expect(rail().locator('[aria-current="page"]')).toHaveCount(1);
  await own.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(side.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
  // Agent itself opens on the conversations.
  await showApps();
  await railButton('Agent').click();
  await expect(side.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  await showApps();
  await own.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toBeVisible();
});
