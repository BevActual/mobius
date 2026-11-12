import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, turnEnded } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

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
/** The desk's large title. */
const GREETING = /^Good (morning|afternoon|evening)$/;
const sent = () => JSON.stringify(model!.requests.at(-1)?.messages ?? []);

test('an empty Agent app is the desk: one greeting, suggestions under it, which are sent as is', async () => {
  await start([says(['Here is an overview.'])]);
  await openApp('Agent');
  const region = shell().getByRole('region', { name: 'Agent conversation' });
  await expect(region.getByRole('heading', { name: GREETING })).toBeVisible();
  await expect(region.getByRole('heading', { name: 'What can I help with?' })).toHaveCount(0);
  // The desk shows what is open in your apps, each row one press from its app.
  await expect(region.getByRole('region', { name: 'Desk' }).getByRole('button', { name: /Browser.*1 tab open/ })).toBeVisible();
  await region.getByRole('group', { name: 'Suggestions' }).getByRole('button', { name: 'What is in my notes?' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Here is an overview.');
  expect(sent()).toContain('give me a short overview');
  // A conversation has started, so the desk has gone; the suggestions hide while you type.
  await expect(region.getByRole('heading', { name: GREETING })).toHaveCount(0);
  await turnEnded(composer());
  await composer().fill('x');
  await expect(region.getByRole('group', { name: 'Suggestions' })).toHaveCount(0);
});

test('the desk is the Agent app’s home: what waits is allowed in place, and what is scheduled comes next', async () => {
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.'])]);
  await shell().evaluate(() => window.mobius.schedules?.add({ title: 'Morning brief', prompt: 'What is on today?', time: '08:00', days: [1, 2, 3, 4, 5, 6, 7], enabled: true }));
  // A conversation started beside the page waits for an approval.
  await composer().fill('make an ideas page');
  await composer().press('Enter');
  await expect(shell().getByRole('group', { name: /Approval needed/ })).toBeVisible();
  await openApp('Agent');
  await shell().getByRole('button', { name: 'Create' }).click();
  const desk = shell().getByRole('region', { name: 'Agent conversation' }).getByRole('region', { name: 'Desk' });
  await expect(desk.getByRole('heading', { name: GREETING })).toBeVisible();
  await expect(desk.locator('.desk-title')).toContainText('1 waiting for you');
  // The conversation that waits is under Now, not again under Recent.
  await expect(desk.getByRole('group', { name: 'Recent' })).toHaveCount(0);
  const now = desk.getByRole('group', { name: 'Now' });
  await expect(now.getByRole('listitem')).toContainText('Wants to');
  await expect(desk.getByRole('group', { name: 'Next' }).getByRole('button', { name: /Morning brief.*at 08:00/ })).toBeVisible();
  await now.getByRole('button', { name: /^Allow .* once$/ }).click();
  await expect(desk.getByRole('group', { name: 'Now' })).toHaveCount(0);
  await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Ideas.md'))).toBe(true);
  // Once it has finished it is under Recent, and one press picks it up again.
  const recent = desk.getByRole('group', { name: 'Recent' }).getByRole('button');
  await expect(recent).toHaveCount(1);
  await recent.click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
});

test('Try another puts the change back and asks Mobius to do it another way', async () => {
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.']), says(['Here is another way.'])]);
  await composer().fill('make an ideas page');
  await composer().press('Enter');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
  const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
  // One bar, the same everywhere: Try another, Discard, Keep.
  // A card from the start: the count, Keep, each change as a link to it, then Try another and Discard.
  await expect(strip.getByRole('button', { name: /changes? in Notes ·? ?Review/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(strip.getByRole('button', { name: 'Discard' })).toBeVisible();
  await strip.getByRole('button', { name: 'Try another' }).click();
  await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Ideas.md'))).toBe(false);
  await expect(log().locator('.msg.assistant').last()).toHaveText('Here is another way.');
  expect(sent()).toContain('Try another way.');
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
  await expect(shell().getByRole('textbox', { name: 'Note text' })).toContainText('Buy stamps');
  await suggestions().getByRole('button', { name: 'Make a to-do list' }).click();
  // The reply's to-do shows as an unticked box with its words.
  await expect(log().locator('.msg.assistant')).toHaveText('Buy stamps');
  await expect(log().locator('.msg.assistant').getByRole('checkbox', { name: 'Not done' })).not.toBeChecked();
  await expect(log().getByRole('list', { name: 'Attached' })).toContainText('Errands');
  expect(sent()).toContain('call the plumber');
});
