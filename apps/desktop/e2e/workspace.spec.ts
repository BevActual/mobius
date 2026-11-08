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
  await expect(railButton('Browser')).toHaveAttribute('aria-current', 'page');
  for (const [name, view] of [['Tasks', '.tasks-page'], ['Notes', '[aria-label="Notes sidebar"]'], ['Search', '.search-page'], ['Agent', '.chat.full']] as const) {
    await railButton(name).click();
    await expect(railButton(name)).toHaveAttribute('aria-current', 'page');
    await expect(shell().locator(view)).toBeVisible();
  }
  await expect(rail().locator('[aria-current="page"]')).toHaveCount(1);
  await railButton('Settings').click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toBeVisible();
  await railButton('Settings').click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toHaveCount(0);
});

test('Search finds notes, tasks and pages in one place and opens each in its own app', async () => {
  seed();
  await start();
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
  await expect(railButton('Tasks')).toHaveAttribute('aria-current', 'page');
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');

  await railButton('Search').click();
  await page.getByRole('radio', { name: 'All' }).click();
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('frost');
  await page.getByRole('list', { name: 'Results' }).getByRole('button', { name: /Garden/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Page text' })).toHaveValue(/tulips before the frost/);
});

test('asking from Search hands the question to the agent', async () => {
  await start([says(['Here is what I found.'])]);
  await railButton('Search').click();
  await shell().getByRole('searchbox', { name: 'Search everything' }).fill('what did I plan for the garden');
  await shell().getByRole('button', { name: /Ask Mobius/ }).click();
  await expect(railButton('Agent')).toHaveAttribute('aria-current', 'page');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Here is what I found.');
});

test('while the agent works the composer says what it is doing, the app it works in glows, and a change elsewhere leaves a dot', async () => {
  await start([callsTool('tasks-add', { list: 'Inbox', text: 'Water the plants' }), says(['Added.'])]);
  await composer().fill('Remind me to water the plants');
  await composer().press('Enter');
  const activity = shell().getByRole('status', { name: 'Agent activity' });
  await expect(activity).toHaveText('Waiting for you to allow it');
  await expect(railButton('Tasks')).toHaveAttribute('data-working', 'true');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added.');
  // The panel says which apps Mobius has worked in during this conversation.
  await expect(shell().locator('.chat-sees')).toHaveText('Sees: Tasks');
  await expect(shell().locator('.msg-sources').last()).toHaveText('Based on Tasks');
  await expect(activity).toHaveCount(0);
  await expect(railButton('Tasks')).not.toHaveAttribute('data-working');
  // The agent changed Tasks while you were in the Browser: a dot until you look.
  await expect(railButton('Tasks')).toHaveAttribute('data-changed', 'true');
  await railButton('Tasks').click();
  await expect(shell().locator('.strip-title')).toHaveText('Today');
  await railButton('Browser').click();
  await expect(railButton('Tasks')).not.toHaveAttribute('data-changed');
});

test('the app hub shows every app with what is happening in it, starts new things, and lists the apps to come', async () => {
  seed();
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), `# Inbox\n\n- [ ] Buy tulip bulbs (due 2001-01-01)\n`);
  await start();
  const opener = shell().getByRole('button', { name: /^Applications/ });
  await opener.click();
  const hub = shell().getByRole('dialog', { name: 'Applications' });
  await expect(hub).toBeVisible();
  const apps = hub.getByRole('region', { name: 'Apps' });
  await expect(apps.getByRole('button', { name: 'Notes, 1 page' })).toBeVisible();
  await expect(apps.getByRole('button', { name: /^Tasks, 1 due today/ })).toBeVisible();
  await expect(apps.getByRole('button', { name: /^Browser, 1 tab open/ })).toHaveAttribute('aria-current', 'page');
  // Apps sit in groups by what they are for; one still to come is in its group, and cannot be opened yet.
  await expect(apps.getByRole('group', { name: 'Write and plan' }).getByRole('button', { name: 'Notes, 1 page' })).toBeVisible();
  await expect(apps.getByRole('group', { name: 'Review' }).getByRole('button', { name: 'Review, not built yet' })).toBeDisabled();
  // Typing narrows it; Enter opens the first app that matches.
  await hub.getByRole('searchbox', { name: 'Find apps' }).fill('tas');
  await expect(apps.getByRole('button')).toHaveCount(1);
  await hub.getByRole('searchbox', { name: 'Find apps' }).press('Enter');
  await expect(hub).toBeHidden();
  await expect(railButton('Tasks')).toHaveAttribute('aria-current', 'page');

  // Start something new from anywhere: a task lands in the Inbox, with the cursor in the new-task box.
  await opener.click();
  await hub.getByRole('region', { name: 'Start something' }).getByRole('button', { name: 'New task' }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  const field = shell().getByRole('textbox', { name: 'New task', exact: true });
  await expect.poll(() => field.evaluate((el) => el === document.activeElement)).toBe(true);
  await opener.click();
  await hub.getByRole('button', { name: 'New note' }).click();
  await expect(railButton('Notes')).toHaveAttribute('aria-current', 'page');
  await expect(shell().getByRole('textbox', { name: 'Page text' })).toHaveValue(/^# Untitled/);
  await opener.click();
  await shell().keyboard.press('Escape');
  await expect(hub).toBeHidden();
});

test('the full sidebar is the default: the apps by name with the open app\'s own list under them; folding it to the rail is remembered', async () => {
  seed();
  await start();
  await expect(rail()).toHaveAttribute('data-expanded', 'true');
  // The Create button follows the app you are in.
  await expect(railButton('Create')).toHaveAttribute('title', 'New tab');
  await expect(rail().getByRole('complementary', { name: 'Browser sidebar' })).toBeVisible();
  await expect(shell().locator('.body > .dock.left')).toHaveCount(0);
  await railButton('Tasks').click();
  await expect(railButton('Create')).toHaveAttribute('title', 'New task');
  await expect(rail().getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await rail().getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Inbox/ }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  await railButton('Create').click();
  const field = shell().getByRole('textbox', { name: 'New task', exact: true });
  await expect.poll(() => field.evaluate((el) => el === document.activeElement)).toBe(true);

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
