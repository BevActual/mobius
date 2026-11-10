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
const DECK = '<!-- style: warm -->\n### Offsite 2027\n# Lisbon, together\nNotes: Welcome everyone.\n\n---\n\n### Why\n## Plan next year in one place\n- Three days, eight people\n- No laptops on day two\n';
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-slides-'));
  fs.mkdirSync(path.join(userData, 'workspace', 'slides', 'Presentations'), { recursive: true });
  fs.writeFileSync(file(), DECK);
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
const page = (): Locator => shell().locator('.slides-page');
const nav = (): Locator => page().getByRole('navigation', { name: 'Slides' });
function file() { return path.join(userData, 'workspace', 'slides', 'Presentations', 'Offsite kickoff.md'); }

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Slides');
  await shell().keyboard.press('Enter');
  await shell().getByRole('tree', { name: 'Folders' }).getByRole('button', { name: 'Offsite kickoff', exact: true }).click();
  await expect(nav().getByRole('button')).toHaveCount(2);
}

test('a deck is a Markdown file of slides, edited on the slide and played full screen', async () => {
  await start();
  await nav().getByRole('button', { name: /^Slide 2: Plan next year/ }).click();
  const title = page().getByRole('textbox', { name: 'Title' });
  await title.fill('Plan 2027 together');
  await expect.poll(() => fs.readFileSync(file(), 'utf8')).toContain('## Plan 2027 together\n- Three days, eight people');
  await page().getByRole('textbox', { name: 'Presenter notes' }).fill('Keep it short.');
  await page().getByRole('button', { name: '+ Slide' }).click();
  await expect(nav().getByRole('button')).toHaveCount(3);
  await page().getByRole('textbox', { name: 'Title' }).fill('Questions?');
  await page().getByRole('combobox', { name: 'Slide style' }).selectOption('accent');
  await expect.poll(() => fs.readFileSync(file(), 'utf8')).toContain('---\n\n<!-- style: accent -->\n## Questions?');
  expect(fs.readFileSync(file(), 'utf8')).toContain('Notes:\nKeep it short.');

  await page().getByRole('button', { name: '▶ Play' }).click();
  const play = shell().getByRole('dialog', { name: /^Playing slide 3 of 3/ });
  await expect(play).toContainText('Questions?');
  await shell().keyboard.press('ArrowLeft');
  await expect(shell().getByRole('dialog', { name: /^Playing slide 2 of 3/ })).toContainText('Plan 2027 together');
  await shell().keyboard.press('Escape');
  await expect(shell().getByRole('dialog', { name: /^Playing/ })).toHaveCount(0);
});

test('slides Mobius adds are dashed in the navigator until kept', async () => {
  await start([
    callsTool('files-edit', { path: 'slides/Presentations/Offsite kickoff.md', old: '- No laptops on day two\n', new: '- No laptops on day two\n\n---\n\n### Agenda\n## Three days\n- 12: arrive\n- 13: plan on the terrace\n- 14: wrap up\n' }),
    says(['I added an agenda slide.']),
  ]);
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Add an agenda slide');
  await composer.press('Enter');
  await shell().getByRole('log', { name: 'Conversation' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('I added an agenda slide.');
  await expect(nav().getByRole('button')).toHaveCount(3);
  await expect(nav().getByRole('button', { name: 'Slide 3: Three days (proposed by Mobius)' })).toBeVisible();
  await expect(nav().locator('[data-proposed]')).toHaveCount(1);
  await page().getByRole('status').getByRole('button', { name: 'Keep' }).click();
  await expect(nav().locator('[data-proposed]')).toHaveCount(0);
  expect(fs.readFileSync(file(), 'utf8')).toContain('## Three days');
});
