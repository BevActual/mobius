import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

const SKILL = '---\nname: compare-stays\ndescription: When choosing where to stay, compare places side by side\n---\n\n1. List the places with price and walk to the venue\n2. Put them in a table in Sheets\n';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-skills-'));
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
const file = (name: string) => path.join(userData, 'workspace', 'skills', name, 'SKILL.md');

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Extensions');
  await shell().keyboard.press('Enter');
  // Abilities opens on its Apps; the skills are a place beside them.
  await shell().getByRole('navigation', { name: 'Abilities' }).getByRole('button', { name: 'Skills' }).click();
}

test('a skill is plain steps kept as SKILL.md, and every change keeps the version before it', async () => {
  await start();
  // New skill is in Add, first in the sidebar as New is in every app.
  await shell().getByRole('button', { name: 'Add', exact: true }).click();
  await shell().getByRole('menuitem', { name: 'New skill' }).click();
  await shell().getByRole('textbox', { name: 'Skill name' }).fill('Compare stays');
  await shell().getByRole('textbox', { name: 'When to use it' }).fill('When choosing where to stay');
  await shell().getByRole('textbox', { name: 'When to use it' }).press('Enter');
  const page = shell().getByRole('region', { name: 'Skills' });
  await expect(page.getByRole('heading', { name: '/compare-stays' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Step 1' }).fill('List the places with price');
  await expect.poll(() => fs.readFileSync(file('compare-stays'), 'utf8')).toContain('1. List the places with price\n');
  await page.getByRole('button', { name: 'Add a step' }).click();
  await page.getByRole('textbox', { name: 'Step 2' }).fill('Check each cancellation policy');
  await expect.poll(() => fs.readFileSync(file('compare-stays'), 'utf8')).toContain('2. Check each cancellation policy\n');
  expect(fs.readFileSync(file('compare-stays'), 'utf8')).toContain('description: When choosing where to stay\n');

  const versions = page.getByRole('region', { name: 'Versions' });
  await expect(versions.getByRole('button', { name: /^Restore version/ }).first()).toBeVisible();
  const before = await versions.getByRole('button', { name: /^Restore version/ }).count();
  await versions.getByRole('button', { name: 'Restore version 1' }).click();
  await expect.poll(() => fs.readFileSync(file('compare-stays'), 'utf8')).not.toContain('List the places with price');
  await expect(versions.getByRole('button', { name: /^Restore version/ })).toHaveCount(before + 1);
});

test('/name asks for a skill, Mobius is told what skills there are, and its improvement is kept or discarded', async () => {
  fs.mkdirSync(path.dirname(file('compare-stays')), { recursive: true });
  fs.writeFileSync(file('compare-stays'), SKILL);
  await start([
    callsTool('skills-read', { name: 'compare-stays' }),
    callsTool('files-edit', { path: 'skills/compare-stays/SKILL.md', old: '2. Put them', new: '2. Check each cancellation policy\n3. Put them' }),
    says(['Compared three places. I added a step to check cancellation policies.']),
  ]);
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('/compare-stays Lisbon, 12 to 14 March');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: skills.read' }).getByRole('button', { name: 'Allow once' }).click();
  await log.getByRole('group', { name: 'Approval needed: files.edit' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('added a step');
  const first = model!.requests[0]! as { messages: Array<{ role: string; content: string }> };
  expect(first.messages.find((m) => m.role === 'system')!.content).toContain('- compare-stays: When choosing where to stay, compare places side by side');
  expect(first.messages.filter((m) => m.role === 'user').pop()!.content).toContain('Use the skill "compare-stays" (read it with skills.read and follow its steps) for: Lisbon, 12 to 14 March');

  const review = shell().getByRole('region', { name: 'Skills' }).getByRole('group', { name: "Mobius's change" });
  await expect(review).toContainText('+ 2. Check each cancellation policy');
  await review.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => fs.readFileSync(file('compare-stays'), 'utf8')).toBe(SKILL);
  await expect(review).toBeHidden();
});

test('a skill someone shared shows what it is for and what it can touch before it is added', async () => {
  await start();
  const shared = '---\nname: Compare Stays\ndescription: When choosing where to stay, compare places side by side\nallowed-tools: browser.read sheets.write\n---\n\n1. Read each place\n2. Put them in a table in Sheets\n';
  await shell().getByLabel('Choose a SKILL.md').setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(shared) });
  const dialog = shell().getByRole('dialog', { name: 'Install a skill' });
  await expect(dialog.getByRole('heading')).toHaveText('Install /Compare Stays?');
  await expect(dialog.getByRole('group', { name: 'What it can touch' })).toContainText('browser.read');
  await expect(dialog.getByRole('group', { name: 'What it can touch' })).toContainText('sheets.write');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog).toBeHidden();
  await expect(shell().getByRole('region', { name: 'Skills' }).getByRole('heading', { name: '/compare-stays' })).toBeVisible();
  expect(fs.readFileSync(file('compare-stays'), 'utf8')).toContain('name: compare-stays\ndescription: When choosing where to stay');
});

test('Abilities is one of Mobius’s own apps: apps, skills and connectors in one place', async () => {
  model = await startModel([]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  const rail = shell().getByRole('navigation', { name: 'Apps' });
  if ((await rail.getAttribute('data-face')) !== 'apps') await rail.locator('[data-app-switcher]').click();
  await rail.getByRole('region', { name: 'Mobius’s apps' }).getByRole('button', { name: 'Abilities', exact: true }).click();
  const places = shell().getByRole('navigation', { name: 'Abilities' });
  await expect(places.getByRole('button')).toHaveText([/^Apps\d+$/, /^Skills\d*$/, /^Connectors\d*$/]);
  await expect(places.getByRole('button', { name: /^Apps/ })).toHaveAttribute('aria-current', 'page');
  // Each app says what it is for and has one switch. Removing one takes it out of the switcher and keeps its files;
  // adding it brings it back.
  const library = shell().getByRole('region', { name: 'Apps' });
  await expect(library.getByRole('region', { name: 'Write and plan' })).toContainText('Spreadsheets with formulas');
  const sheets = library.getByRole('switch', { name: 'Sheets' });
  await expect(sheets).toBeChecked();
  await sheets.click();
  await expect(sheets).not.toBeChecked();
  await expect.poll(async () => (await shell().evaluate(() => window.mobius.preferences.get())).installedApps).not.toContain('sheets');
  await expect(library.getByRole('button', { name: 'Open Sheets' })).toHaveCount(0);
  await sheets.click();
  await expect(sheets).toBeChecked();
  await expect.poll(async () => (await shell().evaluate(() => window.mobius.preferences.get())).installedApps).toContain('sheets');
  // Search narrows the library.
  await shell().getByRole('searchbox', { name: 'Search abilities' }).fill('spreadsheet');
  await expect(library.getByRole('switch')).toHaveCount(1);
  await shell().getByRole('searchbox', { name: 'Search abilities' }).fill('');
  // An added app opens from its row.
  await library.getByRole('button', { name: 'Open Sheets' }).click();
  await expect(rail.locator('[data-app-switcher]')).toHaveAttribute('aria-label', 'Switch app. Current: Sheets');
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Extensions');
  await shell().keyboard.press('Enter');
  await places.getByRole('button', { name: /^Connectors/ }).click();
  const page = shell().getByRole('region', { name: 'Connectors' });
  await expect(page).toContainText('No connectors yet');
  await expect(page.getByRole('switch', { name: 'Let other apps use Mobius' })).toBeVisible();
  // Add a Connector explains mcp.json in a sheet.
  await page.getByRole('button', { name: 'Add a Connector…' }).click();
  const sheet = shell().getByRole('dialog', { name: 'Add a connector' });
  await expect(sheet).toContainText('mcp.json');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
});
