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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-review-'));
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Trip'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Trip', 'Plan.md'), '# Plan\n\nLisbon in March.\n');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

test('Review lists what Mobius changed in every app, by turn, to open or put back', async () => {
  model = await startModel([
    callsTool('files-write', { path: 'notes/Trip/Plan.md', content: '# Plan\n\nLisbon in March, eight of us.\n' }),
    says(['Added who is coming.']),
    callsTool('files-write', { path: 'boards/Offsite/Ideas.json', content: JSON.stringify({ version: 1, items: [{ id: 's1', type: 'sticky', x: 0, y: 0, w: 180, h: 180, color: 'yellow', text: 'Walkable' }] }) }),
    says(['Started a board.']),
  ]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  const log = shell.getByRole('log', { name: 'Conversation' });
  for (const [ask, reply] of [['Say who is coming', 'Added who is coming.'], ['Start a board', 'Started a board.']] as const) {
    await expect(shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await composer.fill(ask);
    await composer.press('Enter');
    await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
    await expect(log.locator('.msg.assistant').last()).toHaveText(reply);
  }
  await expect(shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);

  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Review');
  await shell.keyboard.press('Enter');
  const page = shell.getByRole('region', { name: 'Review' });
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').first()).toContainText('“Start a board”');
  await expect(page.getByRole('article').nth(1)).toContainText('“Say who is coming”');

  // By app: only Canvas's change.
  const side = shell.getByRole('complementary', { name: 'Review sidebar' });
  await side.getByRole('button', { name: /^Canvas/ }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page).toContainText('Offsite / Ideas');
  await side.getByRole('button', { name: /^Everything Mobius changed/ }).click();

  // The note is put back as it was before its turn; the board opens in Canvas.
  await page.getByRole('button', { name: 'Put back Trip / Plan' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Put back' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Trip', 'Plan.md'), 'utf8')).toBe('# Plan\n\nLisbon in March.\n');
  await page.getByRole('button', { name: 'Open Offsite / Ideas' }).click();
  await expect(shell.getByRole('application', { name: 'Board' }).getByLabel('Sticky: Walkable')).toBeVisible();
});
