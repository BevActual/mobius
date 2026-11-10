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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-surface-'));
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
const suggestions = (): Locator => shell().getByRole('group', { name: 'Suggestions' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}
const openApp = async (name: string) => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
  await shell().keyboard.press('Enter');
};
const sent = () => JSON.stringify(model!.requests.at(-1)?.messages ?? []);

test('an empty Agent app greets you in the middle and suggests a start, which is sent as is', async () => {
  await start([says(['Here is an overview.'])]);
  await openApp('Agent');
  const region = shell().getByRole('region', { name: 'Agent conversation' });
  await expect(region.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
  // Under the greeting is the desk: what is open in your apps, each row one press from its app.
  await expect(region.getByRole('region', { name: 'Desk' }).getByRole('button', { name: /Browser.*1 tab open/ })).toBeVisible();
  await region.getByRole('group', { name: 'Suggestions' }).getByRole('button', { name: 'What is in my notes?' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Here is an overview.');
  expect(sent()).toContain('give me a short overview');
  // A conversation has started, so the greeting has gone; the suggestions hide while you type.
  await expect(region.getByRole('heading', { name: 'What can I help with?' })).toHaveCount(0);
  await composer().fill('x');
  await expect(region.getByRole('group', { name: 'Suggestions' })).toHaveCount(0);
});

test('a suggestion that starts a sentence puts it in the box for you to finish', async () => {
  await start();
  await openApp('Agent');
  await suggestions().getByRole('button', { name: 'Draft something' }).click();
  await expect(composer()).toHaveValue('Help me draft ');
  await expect(composer()).toBeFocused();
  expect(model!.requests).toHaveLength(0);
});

test('in the browser, a page suggestion attaches the page you see, as a chip', async () => {
  await start([says(['A short summary.'])]);
  const address = shell().getByRole('textbox', { name: 'Address or question' });
  await address.fill(fixture.origin + '/article');
  await address.press('Enter');
  await expect(shell().locator('.tab-title').first()).toHaveText('Article');
  await suggestions().getByRole('button', { name: 'Summarise this page' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('A short summary.');
  await expect(log().getByRole('list', { name: 'Attached' })).toContainText('Article');
  expect(sent()).toContain('Summarise this page');
});

test('in Notes, a note suggestion attaches the open note', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Home'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Home', 'Errands.md'), '# Errands\nBuy stamps and call the plumber.\n');
  await start([says(['- [ ] Buy stamps']) ]);
  await openApp('Notes');
  const side = shell().getByRole('complementary', { name: 'Notes sidebar' });
  await side.getByRole('button', { name: 'Errands', exact: true }).click();
  await expect(shell().getByRole('textbox', { name: 'Page text' })).toHaveValue(/Buy stamps/);
  await suggestions().getByRole('button', { name: 'Make a to-do list' }).click();
  // The reply's to-do shows as an unticked box with its words.
  await expect(log().locator('.msg.assistant')).toHaveText('Buy stamps');
  await expect(log().locator('.msg.assistant').getByRole('checkbox', { name: 'Not done' })).not.toBeChecked();
  await expect(log().getByRole('list', { name: 'Attached' })).toContainText('Errands');
  expect(sent()).toContain('call the plumber');
});
