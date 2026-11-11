import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coreCall, launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-modes-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

async function start(replies: ModelReply[]): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { openMobius: true, userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const card = (): Locator => shell().getByRole('group', { name: /Approval needed/ });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};
const setMode = async (mode: 'manual' | 'propose' | 'smart' | 'off') => {
  await shell().evaluate((m) => window.mobius.preferences.set({ approvalMode: m }), mode);
};
const coreMode = async () => (await coreCall<{ mode: string }>(mobius!.app, 'permissions.mode', {})).mode;

test('with approvals off (from before the three modes) the agent opens a site without asking but a click still asks; back to manual it asks again', async () => {
  await start([callsTool('browser-open', { url: fixture.origin + '/second' }), says(['Opened.']), callsTool('browser-click', { text: 'More' }), says(['Clicked.']), callsTool('browser-tabs'), says(['Listed.'])]);
  await expect.poll(coreMode).toBe('manual');
  await setMode('off');
  await expect.poll(coreMode).toBe('off');
  await say('open');
  await expect(log().locator('.msg.assistant')).toHaveText('Opened.');
  await expect(card()).toHaveCount(0);
  await say('click');
  // Clicking in a page is a floor: it asks in every mode, Off too.
  await expect(card()).toContainText('Needs you');
  await card().getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Clicked.');
  await setMode('manual');
  await expect.poll(coreMode).toBe('manual');
  await say('list');
  await expect(card()).toBeVisible();
  await card().getByRole('button', { name: 'Decline' }).click();
});

test('the settings page shows Ask first, explains Propose, and the choice survives a restart into the core', async () => {
  await start([]);
  await openSettings(shell());
  await expect(page()).toBeVisible();
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Approvals and safety', exact: true }).click();
  await expect(page().getByRole('radiogroup', { name: 'Approval mode' }).getByRole('radio', { name: 'Ask first' })).toBeChecked();
  await expect(page().getByTestId('approval-mode-help')).toContainText('asked about every time');
  await page().getByRole('radiogroup', { name: 'Approval mode' }).getByRole('radio', { name: 'Propose' }).check();
  await expect(page().getByTestId('approval-mode-help')).toContainText('Keep it, Discard it or ask it to Try another way');
  await expect.poll(coreMode).toBe('propose');
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { openMobius: true, userData });
  await expect.poll(coreMode).toBe('propose');
});

test('in Propose a note is written without asking and waits to be kept, while opening a site still asks', async () => {
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.']), callsTool('browser-open', { url: fixture.origin + '/second' }), says(['Opened.'])]);
  await setMode('propose');
  await expect.poll(coreMode).toBe('propose');
  await say('make an ideas page');
  await expect(log().locator('.msg.assistant')).toHaveText('Made it.');
  await expect(card()).toHaveCount(0);
  expect(fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Ideas.md'))).toBe(true);
  const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
  await expect(strip.getByRole('button', { name: 'Keep' })).toBeVisible();
  await strip.getByRole('button', { name: 'Keep' }).click();
  await say('open the second page');
  await expect(card()).toBeVisible();
  await card().getByRole('button', { name: 'Decline' }).click();
});

test('the shell cannot name a mode that does not exist', async () => {
  await start([]);
  const after = await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'auto' as never }));
  expect(after?.approvalMode).toBe('manual');
  await expect.poll(coreMode).toBe('manual');
});

test('with smart approvals a reviewer approves a clearly safe open without asking, and only the call is shown to it', async () => {
  await start([callsTool('browser-open', { url: fixture.origin + '/second' }), says(['APPROVE']), says(['Opened.'])]);
  await setMode('smart');
  await expect.poll(coreMode).toBe('smart');
  await say('open');
  await expect(log().locator('.msg.assistant')).toHaveText('Opened.');
  await expect(card()).toHaveCount(0);
  const review = model!.requests[1] as { messages: Array<{ role: string; content: string }>; tools?: unknown[] };
  expect(review.tools ?? []).toHaveLength(0);
  expect(JSON.stringify(review.messages)).toContain('browser.open');
  expect(JSON.stringify(review.messages)).not.toContain('say open');
  // Nothing was left standing: Settings lists no always-allowed approval.
  const grants = await coreCall<Array<{ duration: string }>>(mobius!.app, 'permissions.grants', {});
  expect(grants.filter((g) => g.duration === 'always' || g.duration === 'session')).toHaveLength(0);
});

test('with smart approvals a DENY asks the person, who can allow it once but never always', async () => {
  await start([callsTool('browser-open', { url: fixture.origin + '/second' }), says(['DENY']), says(['Opened.'])]);
  await setMode('smart');
  await expect.poll(coreMode).toBe('smart');
  await say('open');
  await expect(card()).toBeVisible();
  await expect(card()).toContainText('Needs you');
  await expect(card().getByRole('button', { name: 'Always allow' })).toHaveCount(0);
  await card().getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Opened.');
});

test('in Act, clicking in a page is never left to the reviewer: it stops as Needs you, allow once only', async () => {
  await start([callsTool('browser-click', { text: 'More' }), says(['Clicked.'])]);
  await setMode('smart');
  await expect.poll(coreMode).toBe('smart');
  await say('click');
  await expect(card()).toContainText('Needs you');
  await expect(card().getByRole('button', { name: 'Always allow' })).toHaveCount(0);
  // The reviewer was not asked: the only call to the model so far is the turn itself.
  expect(model!.requests).toHaveLength(1);
  await card().getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Clicked.');
});

test('with smart approvals an unsure or unreadable review asks the person as usual', async () => {
  await start([callsTool('browser-tabs'), says(['I am not sure']), says(['Listed.'])]);
  await setMode('smart');
  await expect.poll(coreMode).toBe('smart');
  await say('list');
  await expect(card()).toBeVisible();
  await expect(card().getByRole('button', { name: 'Always allow' })).toBeVisible();
  await card().getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Listed.');
});

test('per app: Tasks following Propose changes a list without asking, Always ask asks each time, and Off stops it', async () => {
  await start([
    callsTool('tasks-add', { list: 'Inbox', text: 'Water the plants' }), says(['Added.']),
    callsTool('tasks-add', { list: 'Inbox', text: 'Buy stamps' }), says(['Left it.']),
    callsTool('tasks-add', { list: 'Inbox', text: 'Feed the cat' }), says(['Could not.']),
  ]);
  await setMode('propose');
  await say('remind me to water the plants');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Added.');
  await expect(card()).toHaveCount(0);
  expect(fs.readFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), 'utf8')).toContain('Water the plants');
  await openSettings(shell());
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Approvals and safety', exact: true }).click();
  await page().getByRole('radiogroup', { name: 'Tasks: what Mobius may do' }).getByRole('radio', { name: 'Always ask' }).check();
  await expect(page()).toContainText('Mobius asks you every time before it reads or changes your tasks.');
  await page().getByRole('button', { name: 'Close settings' }).click();
  await say('remind me to buy stamps');
  await expect(card()).toBeVisible();
  // Asked every time: there is no always-allow answer.
  await expect(card().getByRole('button', { name: 'Always allow' })).toHaveCount(0);
  await card().getByRole('button', { name: 'Decline' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Left it.');
  await mobius!.shell.evaluate(() => window.mobius.preferences.set({ approvalMode: 'off', appAccess: { browser: 'follow', notes: 'follow', tasks: 'off' } }));
  await say('remind me to feed the cat');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Could not.');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), 'utf8')).not.toContain('Feed the cat');
});

test('sign in once per task: a page that asks for a password stops as Needs you, the person signs in, and the task does not ask again', async () => {
  await start([
    callsTool('browser-open', { url: fixture.origin + '/form' }), says(['I need you to sign in.']),
    says(['Carrying on.']),
    callsTool('browser-open', { url: fixture.origin + '/form' }), says(['Opened it again.']),
  ]);
  await setMode('propose');
  await say('open the form');
  await card().getByRole('button', { name: 'Allow once' }).click();
  const signIn = shell().getByRole('group', { name: /^Sign in to 127\.0\.0\.1/ });
  await expect(signIn).toContainText('Needs you');
  await expect(log().locator('.msg.assistant').last()).toHaveText('I need you to sign in.');
  await signIn.getByRole('button', { name: 'Sign in' }).click();
  await signIn.getByRole('button', { name: 'Done, I signed in' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Carrying on.');
  const line = shell().getByRole('status').filter({ hasText: /Signed in to 127\.0\.0\.1.* for this task/ });
  await expect(line).toBeVisible();
  // A later step of the same task does not ask again.
  await say('open the form again');
  await card().getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Opened it again.');
  await expect(shell().getByRole('group', { name: /^Sign in to/ })).toHaveCount(0);
  await line.getByRole('button', { name: 'Sign out now' }).click();
  await expect(line).toHaveCount(0);
});
