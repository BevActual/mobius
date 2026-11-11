import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';
import { says, startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let broken: ModelFixture | undefined;
let backup: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-fallback-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await broken?.close();
  await backup?.close();
  broken = backup = undefined;
  await fixture.close();
  removeTestData(userData);
});

// The first model answers every request with an error (HTTP 500); the second answers properly.
async function start(): Promise<Launched> {
  broken = await startModel([]);
  backup = await startModel([says(['From the backup model.'])]);
  mobius = await launch(fixture.origin + '/', { openMobius: true, userData, env: { MOBIUS_AGENT_URL: broken.url, MOBIUS_AGENT_MODEL: 'first-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const openServer = async () => {
  await openSettings(shell());
  await expect(page()).toBeVisible();
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  await page().getByRole('tab', { name: 'Defaults', exact: true }).click();
};

test('a second model answers when the first fails, and the conversation says so', async () => {
  await start();
  await openServer();
  await page().getByRole('switch', { name: 'Use a second model when the first cannot answer' }).check();
  await page().getByLabel('Second model address').fill(backup!.url);
  await page().getByLabel('Second model name').fill('backup-model');
  await page().getByRole('button', { name: 'Save' }).click();
  await expect(page().getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await shell().keyboard.press('Escape');

  await composer().fill('hello');
  await composer().press('Enter');
  await expect(log().locator('.msg.assistant')).toHaveText('From the backup model.');
  await expect(log().getByRole('status').filter({ hasText: 'Switched to backup-model' })).toBeVisible();
  expect(broken!.requests).toHaveLength(1);
  expect(broken!.requests[0]).toMatchObject({ model: 'first-model' });
  expect(backup!.requests).toHaveLength(1);
  expect(backup!.requests[0]).toMatchObject({ model: 'backup-model' });
});

test('without a second model, a failing first model shows its error as before', async () => {
  await start();
  await composer().fill('hello');
  await composer().press('Enter');
  await expect(log().getByRole('alert')).toBeVisible();
  await expect(log().getByRole('status').filter({ hasText: 'Switched to' })).toHaveCount(0);
});

test('the second model is remembered across a restart, and can be switched off', async () => {
  await start();
  await openServer();
  await page().getByRole('switch', { name: 'Use a second model when the first cannot answer' }).check();
  await page().getByLabel('Second model address').fill(backup!.url);
  await page().getByLabel('Second model name').fill('backup-model');
  await page().getByRole('button', { name: 'Save' }).click();
  await expect(page().getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await mobius!.close({ keepUserData: true });
  // Start again with nothing seeded, so what comes back is what was saved.
  mobius = await launch(fixture.origin + '/', { openMobius: true, userData });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openServer();
  await expect(page().getByRole('switch', { name: 'Use a second model when the first cannot answer' })).toBeChecked();
  await expect(page().getByLabel('Second model name')).toHaveValue('backup-model');
  await page().getByRole('switch', { name: 'Use a second model when the first cannot answer' }).uncheck();
  await page().getByRole('button', { name: 'Save' }).click();
  await expect(page().getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const settings = await shell().evaluate(() => window.mobius.agent.getSettings());
  expect(settings.fallbackModel).toBe('');
});
