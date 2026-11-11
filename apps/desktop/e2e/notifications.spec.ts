import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { holdingAwake, launch, recordedNotices, startFixture, type Fixture, type Launched, openSettings } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let downloads: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-notice-dl-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  fs.rmSync(downloads, { recursive: true, force: true });
});

async function start(replies: ModelReply[]): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_DOWNLOADS_DIR: downloads, MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};
type Seen = { kind: string; title: string; body: string; silent: boolean };
// The test window is hidden, so it never has the focus: every notice that would be shown is recorded instead.
const notices = (): Promise<Seen[]> => recordedNotices<Seen>(mobius!.app);
const awake = (): Promise<boolean> => holdingAwake(mobius!.app);
const openPage = async (section: string, tab?: string) => {
  // The Settings button closes Settings when it is already open, so only press it to open.
  if ((await page().count()) === 0) await openSettings(shell());
  await expect(page()).toBeVisible();
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
  if (tab) await page().getByRole('tab', { name: tab, exact: true }).click();
};
const closeSettings = async () => {
  await page().getByRole('button', { name: 'Close settings' }).click();
  await expect(page()).toHaveCount(0);
};

test('a notice appears when the agent needs you, and again when it finishes, without saying what was asked', async () => {
  await start([callsTool('browser-tabs'), says(['Done now.'])]);
  await say('please list my tabs');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Done now.');
  await expect.poll(async () => (await notices()).map((n) => n.kind)).toEqual(['needs-you', 'finished']);
  const all = await notices();
  expect(all[0]).toMatchObject({ title: 'Mobius needs you', body: 'It is waiting to use browser.tabs.' });
  expect(JSON.stringify(all)).not.toContain('please list my tabs');
});

test('each kind of alert can be turned off, and sounds can be muted', async () => {
  await start([callsTool('browser-tabs'), says(['One.']), says(['Two.'])]);
  await openPage('Notifications', 'Alerts');
  await page().getByRole('switch', { name: 'When it needs you' }).uncheck();
  await openPage('Notifications', 'Sounds');
  await page().getByRole('switch', { name: 'Mute notification sounds' }).check();
  await closeSettings();
  await say('go');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('One.');
  await expect.poll(async () => (await notices()).map((n) => n.kind)).toEqual(['finished']);
  expect((await notices())[0]?.silent).toBe(true);
  await openPage('Notifications', 'Alerts');
  await page().getByRole('switch', { name: 'When a request finishes' }).uncheck();
  await closeSettings();
  await say('again');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Two.');
  expect(await notices()).toHaveLength(1);
});

test('a finished download is announced ', async () => {
  await start([]);
  const address = shell().getByRole('textbox', { name: 'Address or question' });
  await address.fill(fixture.origin + '/file.txt');
  await address.press('Enter');
  await expect(shell().getByRole('region', { name: 'Downloads' })).toContainText('Done');
  await expect.poll(async () => (await notices()).map((n) => `${n.kind}:${n.body}`)).toEqual(['download:file.txt']);
});

test('keeping the computer awake follows the setting and the work', async () => {
  await start([callsTool('browser-tabs'), says(['Done ', 'slowly ', 'now.'], 700)]);
  expect(await awake()).toBe(false);
  await openPage('General');
  await page().getByRole('switch', { name: 'Keep the computer awake while working' }).check();
  await closeSettings();
  await say('go');
  // While the agent waits for an answer the computer may sleep.
  await expect(shell().getByRole('group', { name: /Approval needed/ })).toBeVisible();
  expect(await awake()).toBe(false);
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect.poll(awake).toBe(true);
  await expect(log().locator('.msg.assistant')).toHaveText('Done slowly now.');
  await expect.poll(awake).toBe(false);
  // Turned off, nothing is held even while working.
  await openPage('General');
  await page().getByRole('switch', { name: 'Keep the computer awake while working' }).uncheck();
  await closeSettings();
  expect(await awake()).toBe(false);
});
