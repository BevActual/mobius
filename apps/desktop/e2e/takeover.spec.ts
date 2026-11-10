import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-takeover-'));
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Work'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Plan.md'), '# Plan\n');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

test('Take over pauses Mobius at the next safe point; Hand back makes it read again and go on', async () => {
  model = await startModel([callsTool('files-read', { path: 'notes/Work/Plan.md' }), says(['Carried on.'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('Tidy my plan');
  await composer.press('Enter');
  const log = shell.getByRole('log', { name: 'Conversation' });
  const card = log.getByRole('group', { name: 'Approval needed: files.read' });
  await expect(card).toBeVisible();

  await shell.getByRole('button', { name: 'Take over' }).click();
  const bar = shell.getByRole('status', { name: 'You have control' });
  await expect(bar).toContainText('You have control · Mobius paused at step 1');
  await expect(shell.getByRole('button', { name: 'Take over' })).toHaveCount(0);
  // The read goes ahead when allowed, but Mobius does not take its next step while the apps are yours.
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.tool')).toContainText('files.read');
  await shell.waitForTimeout(800);
  expect(model.requests).toHaveLength(1);

  await bar.getByRole('button', { name: 'Hand back' }).click();
  await expect(bar).toBeHidden();
  await expect(log.locator('.msg.assistant')).toContainText('Carried on.');
  const system = (model.requests[1]!.messages as Array<{ role: string; content: string }>)[0]!.content;
  expect(system).toContain('The person took over for a while');
});

test('Stop on the control bar ends the task', async () => {
  model = await startModel([callsTool('files-read', { path: 'notes/Work/Plan.md' }), says(['never'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('Tidy my plan');
  await composer.press('Enter');
  await expect(shell.getByRole('group', { name: 'Approval needed: files.read' })).toBeVisible();
  await shell.getByRole('button', { name: 'Take over' }).click();
  const bar = shell.getByRole('status', { name: 'You have control' });
  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toBeHidden();
  await expect(shell.getByRole('button', { name: 'Send' })).toBeVisible();
});
