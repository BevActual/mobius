import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-files-'));
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

const shell = () => mobius!.shell;

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
}
async function openFiles(): Promise<void> {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Files');
  await shell().keyboard.press('Enter');
}

test('Files shows the workspace as a drive, folder by folder, and a file opens in its app', async () => {
  await start();
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files' });
  await page.getByRole('button', { name: 'notes', exact: true }).click();
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Folder' })).toHaveText('Workspace › notes › Work');
  await page.getByRole('button', { name: 'Plan.md', exact: true }).click();
  await expect(shell().getByRole('region', { name: 'Note: Plan' })).toBeVisible();
});

test('what Mobius made is in Made by Mobius, dashed in the drive, until it is kept', async () => {
  await start([
    callsTool('files-write', { path: 'notes/Work/Brief.md', content: '# Brief\n\nFrom Mobius.\n' }),
    says(['I wrote a brief.']),
  ]);
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Write a brief');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('I wrote a brief');
  await openFiles();
  const side = shell().getByRole('navigation', { name: 'Files' });
  await side.getByRole('button', { name: /Made by Mobius/ }).click();
  const made = shell().getByRole('region', { name: 'Made by Mobius' });
  await expect(made.getByRole('button', { name: 'Work / Brief, from Mobius' })).toHaveAttribute('data-proposed');
  await side.getByRole('button', { name: 'Workspace' }).click();
  const page = shell().getByRole('region', { name: 'Files' });
  await expect(page.getByRole('button', { name: 'notes, from Mobius' })).toBeVisible();
  await page.getByRole('button', { name: 'notes, from Mobius' }).click();
  await page.getByRole('button', { name: 'Work, from Mobius' }).click();
  await expect(page.getByRole('button', { name: 'Brief.md, from Mobius' })).toBeVisible();
  await side.getByRole('button', { name: /Made by Mobius/ }).click();
  await made.getByRole('group', { name: "Mobius's change" }).getByRole('button', { name: 'Keep' }).click();
  await expect(made).toContainText('Nothing is waiting');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Brief.md'), 'utf8')).toContain('From Mobius.');
});
