import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { says, startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-trust-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

test('each fact says where it came from, and a reply with an unsure fact is not copied until it is checked', async () => {
  model = await startModel([says(['Hi Rui, confirming the terrace for [8 people](trust:yours "Calendar · Offsite crew") arriving ', '[around 12:30](trust:unsure "Two people have not shared flights") on [Thursday 12 March](trust:web "tap.pt, today").'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('Write Rui a confirmation');
  await composer.press('Enter');
  const reply = shell.getByRole('log', { name: 'Conversation' }).locator('.msg.assistant');
  await expect(reply).toHaveText('Hi Rui, confirming the terrace for 8 people arriving around 12:30 on Thursday 12 March.');
  expect(JSON.stringify(model.requests[0])).toContain('trust:unsure');

  const sure = reply.getByRole('button', { name: '8 people — From your stuff: Calendar · Offsite crew' });
  await expect(sure).toBeVisible();
  const unsure = reply.getByRole('button', { name: 'around 12:30 — Not sure: Two people have not shared flights' });
  await expect(shell.getByText('Check 1 unsure fact before copying')).toBeVisible();
  await expect(shell.getByRole('button', { name: 'Copy reply' })).toHaveCount(0);
  await unsure.click();
  await reply.getByRole('note').getByRole('button', { name: 'I checked this' }).click();
  await expect(reply.getByRole('button', { name: 'around 12:30 — Checked by you: Two people have not shared flights' })).toBeVisible();
  await expect(shell.getByRole('button', { name: 'Copy reply' })).toBeVisible();
});
