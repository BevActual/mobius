import { expect, test, type Locator } from '@playwright/test';
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-journey-'));
  fs.writeFileSync(file(), '# What Mobius remembers\n\n- Likes boutique hotels <!-- prefs · Browser, June -->\n- Rui runs the terrace venue <!-- people · Mail -->\n- Uses metric units\n');
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
const page = (): Locator => shell().locator('.journey-page');
const list = (): Locator => page().getByRole('list', { name: 'Memories' });
function file() { return path.join(userData, 'memory.md'); }

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Journey');
  await shell().keyboard.press('Enter');
  await expect(page()).toBeVisible();
}

test('what Mobius remembers is sorted by kind with where it was noticed, and can be added to, changed and forgotten', async () => {
  await start();
  await expect(list().getByRole('listitem')).toHaveCount(3);
  await expect(list().getByRole('listitem', { name: 'Likes boutique hotels' })).toContainText('PreferencesLikes boutique hotelsFrom Browser, June');
  await shell().getByRole('navigation', { name: 'Kinds' }).getByRole('button', { name: /^People/ }).click();
  await expect(list().getByRole('listitem')).toHaveCount(1);
  await shell().getByRole('navigation', { name: 'Kinds' }).getByRole('button', { name: /^Everything/ }).click();

  await page().getByRole('textbox', { name: 'Something for Mobius to remember' }).fill('Ana and Ken fly from London');
  await page().getByRole('combobox', { name: 'Kind of memory' }).selectOption('people');
  await page().getByRole('button', { name: 'Add' }).click();
  await expect.poll(() => fs.readFileSync(file(), 'utf8')).toContain('- Ana and Ken fly from London <!-- people · you added it -->');

  await list().getByRole('listitem', { name: 'Rui runs the terrace venue' }).getByRole('button', { name: 'Edit' }).click();
  await page().getByRole('textbox', { name: 'Memory', exact: true }).fill('Rui runs the terrace venue; prefers email');
  await page().getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => fs.readFileSync(file(), 'utf8')).toContain('- Rui runs the terrace venue; prefers email <!-- people · Mail -->');

  await list().getByRole('button', { name: 'Forget: Uses metric units' }).click();
  await expect.poll(() => fs.readFileSync(file(), 'utf8')).not.toContain('metric');
});

test('what Mobius would like to remember waits in Journey until the person says Remember', async () => {
  await start([callsTool('memory-remember', { text: 'Prefers vegetarian options at team meals', category: 'prefs', source: 'Mail from Rui' }), says(['Noted.'])]);
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Remember that I prefer vegetarian options at team meals');
  await composer.press('Enter');
  const ask = page().getByRole('group', { name: 'Mobius would like to remember' });
  await expect(ask).toContainText('“Prefers vegetarian options at team meals”');
  await expect(ask).toContainText('Noticed in Mail from Rui');
  await ask.getByRole('button', { name: 'Remember' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Noted.');
  await expect(list().getByRole('listitem', { name: 'Prefers vegetarian options at team meals' })).toContainText('From Mail from Rui');
  expect(fs.readFileSync(file(), 'utf8')).toContain('- Prefers vegetarian options at team meals <!-- prefs · Mail from Rui -->');
});
