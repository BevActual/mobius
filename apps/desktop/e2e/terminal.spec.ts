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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-terminal-'));
  fs.mkdirSync(path.join(userData, 'workspace', 'code', 'site'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'code', 'site', 'hello.txt'), 'hello from the site\n');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

test('commands run in the workspace, cd stays inside it, one keeps running until stopped, and Mobius explains output', async () => {
  model = await startModel([says(['It printed the file: one line of text.'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  await expect(shell.getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Terminal');
  await shell.keyboard.press('Enter');

  const page = shell.getByRole('region', { name: 'Terminal' });
  const screen = page.getByRole('log', { name: 'Terminal output' });
  const line = page.getByRole('textbox', { name: 'Command' });
  const type = async (command: string) => { await expect(line).toBeEnabled(); await line.fill(command); await line.press('Enter'); };

  await type('cd code/site');
  await expect(page.locator('.term-input .term-prompt')).toHaveText('~/code/site $');
  await type(process.platform === 'win32' ? 'type hello.txt' : 'cat hello.txt');
  await expect(screen.locator('.term-out').last()).toHaveText('hello from the site');
  await type('cd ../../..');
  await expect(screen).toContainText('that is outside the workspace');
  await expect(page.locator('.term-input .term-prompt')).toHaveText('~/code/site $');
  // Earlier lines come back with the arrow keys.
  await line.press('ArrowUp');
  await expect(line).toHaveValue('cd ../../..');
  await line.press('ArrowUp');
  await expect(line).toHaveValue(process.platform === 'win32' ? 'type hello.txt' : 'cat hello.txt');
  await line.fill('');

  // Mobius reads the last output when asked.
  await shell.getByRole('button', { name: 'Explain this' }).click();
  await expect(shell.getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toContainText('one line of text');
  expect(JSON.stringify(model.requests[0]!.messages)).toContain('hello from the site');

  // A command that keeps running is listed with what it prints, and stops.
  await page.getByRole('checkbox', { name: 'Keep running' }).check();
  await type('node -e "setInterval(() => console.log(\'tick\'), 200)"');
  const running = shell.getByRole('list', { name: 'Running commands' });
  await expect(running.locator('li[data-running]')).toHaveCount(1);
  await running.getByRole('button', { name: /setInterval/ }).click();
  await expect(running.getByLabel(/Output of/)).toContainText('tick');
  await running.getByRole('button', { name: 'Stop' }).click();
  await expect(running.locator('li[data-running]')).toHaveCount(0);
});
