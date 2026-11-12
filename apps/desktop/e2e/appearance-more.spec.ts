import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-look-'));
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
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
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
const openPage = async (section: string, tab?: string) => {
  await openSettings(shell());
  await expect(page()).toBeVisible();
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
  if (tab) await page().getByRole('tab', { name: tab, exact: true }).click();
};
const closeSettings = async () => {
  await shell().keyboard.press('Escape');
  await expect(page()).toHaveCount(0);
};
// A message styled by the stylesheet, without needing a model reply.
const styleOfMessage = (prop: string) => shell().evaluate((p) => {
  const probe = document.createElement('div');
  probe.className = 'msg';
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).getPropertyValue(p);
  probe.remove();
  return value;
}, prop);

test('the conversation font and text direction change how messages are drawn', async () => {
  await start([]);
  await openPage('Appearance', 'Typography');
  await page().getByRole('radio', { name: 'Serif' }).check();
  await expect.poll(() => styleOfMessage('font-family')).toMatch(/serif|Georgia/i);
  await page().getByRole('radio', { name: 'Monospace' }).check();
  await expect.poll(() => styleOfMessage('font-family')).toMatch(/mono|Consolas/i);
  await page().getByRole('radio', { name: 'System' }).check();
  await expect.poll(() => styleOfMessage('font-family')).not.toMatch(/mono|Georgia/i);
  await page().getByRole('tab', { name: 'Conversation', exact: true }).click();
  await page().getByRole('radio', { name: 'Right to left' }).check();
  await expect.poll(() => styleOfMessage('direction')).toBe('rtl');
  await page().getByRole('radio', { name: 'Left to right' }).check();
  await expect.poll(() => styleOfMessage('direction')).toBe('ltr');
});

test('compact density packs the tab list tighter', async () => {
  await start([]);
  const height = async () => (await shell().locator('.tab-main').first().boundingBox())!.height;
  const before = await height();
  await openPage('Appearance', 'Layout');
  await page().getByRole('radio', { name: 'Compact' }).check();
  await closeSettings();
  await expect.poll(height).toBeLessThan(before);
});

test('hiding finished tool steps keeps the ones that still need you', async () => {
  await start([callsTool('browser-tabs'), says(['One tab.']), callsTool('browser-tabs'), says(['Still one.'])]);
  await say('tabs?');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('One tab.');
  await expect(shell().locator('.tool')).toBeVisible();
  await openPage('Appearance', 'Conversation');
  await page().getByRole('radio', { name: 'Hide finished' }).check();
  await closeSettings();
  await expect(shell().locator('.tool')).toBeHidden();
  await say('again?');
  await expect(shell().getByRole('group', { name: /Approval needed/ })).toBeVisible();
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Still one.');
  await expect(shell().locator('.tool:visible')).toHaveCount(0);
  await openPage('Appearance', 'Conversation');
  await page().getByRole('radio', { name: 'Show all' }).check();
  await closeSettings();
  await expect(shell().locator('.tool:visible')).toHaveCount(2);
});

test('the tab list can start closed, and the choice survives a restart', async () => {
  await start([]);
  // The tab list beside the page belongs to the narrow rail; the full sidebar always shows it.
  await shell().evaluate(() => window.mobius.appearance.set({ navigation: 'rail' }));
  await expect(shell().getByRole('complementary', { name: 'Browser sidebar' })).toBeVisible();
  await openPage('Appearance', 'Layout');
  await page().getByRole('switch', { name: 'Show the tab list at start' }).uncheck();
  await closeSettings();
  await expect(shell().getByRole('complementary', { name: 'Browser sidebar' })).toBeVisible();
  await mobius!.close({ keepUserData: true });
  await model!.close();
  await start([]);
  await expect(shell().getByRole('complementary', { name: 'Browser sidebar' })).toHaveCount(0);
  await shell().getByRole('button', { name: 'Show tabs' }).click();
  await expect(shell().getByRole('complementary', { name: 'Browser sidebar' })).toBeVisible();
});

test('turning off "reopen the last conversation" starts blank next time', async () => {
  await start([says(['An earlier answer.'])]);
  await say('hello there');
  await expect(log().locator('.msg.assistant')).toHaveText('An earlier answer.');
  await mobius!.close({ keepUserData: true });
  await model!.close();
  await start([]);
  await expect(log().locator('.msg.assistant')).toHaveText('An earlier answer.');
  await openPage('General');
  await page().getByRole('switch', { name: 'Reopen the last conversation' }).uncheck();
  await closeSettings();
  await mobius!.close({ keepUserData: true });
  await model!.close();
  await start([]);
  await expect(log().locator('.msg')).toHaveCount(0);
});
