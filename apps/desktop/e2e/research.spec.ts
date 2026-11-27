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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-research-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

const FILE = 'research/Research/Boutique hotels in Principe Real.md';
const report = (origin: string, extra = '') => `# Boutique hotels in Príncipe Real

Casa Amora is the closest fit: [nine rooms](trust:web "${origin}/casa-amora") and breakfast included.
${extra}
## Sources

- [Casa Amora](${origin}/casa-amora) — rooms and breakfast

## Next questions

- Is there parking nearby?
`;

test('a question becomes a report with its sources, written by Mobius from the web; a follow-up adds to it and can be discarded', async () => {
  model = await startModel([
    callsTool('web-search', { query: 'boutique hotel Principe Real' }),
    callsTool('web-read', { url: `${fixture.origin}/casa-amora` }),
    callsTool('files-write', { path: FILE, content: report(fixture.origin) }),
    says(['Casa Amora: nine rooms, breakfast included.']),
    callsTool('files-write', { path: FILE, content: report(fixture.origin, '\n## Porto\n\nNothing as close in Porto.\n') }),
    says(['Added a Porto section.']),
  ]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model', MOBIUS_WEB_SEARCH_URL: `${fixture.origin}/search/` } });
  const shell = mobius.shell;
  await expect(shell.getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Research');
  await shell.keyboard.press('Enter');

  const page = shell.getByRole('region', { name: 'Research' });
  await page.getByRole('textbox', { name: 'Research question' }).fill('Boutique hotels in Principe Real?');
  await page.getByRole('button', { name: 'Start research' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mobius is researching' })).toBeVisible();
  const file = path.join(userData, 'workspace', ...FILE.split('/'));
  expect(fs.readFileSync(file, 'utf8')).toContain('> Boutique hotels in Principe Real?');

  const log = shell.getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: web.search' }).getByRole('button', { name: 'Allow once' }).click();
  await log.getByRole('group', { name: 'Approval needed: web.read' }).getByRole('button', { name: 'Allow once' }).click();
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('breakfast included');
  expect(JSON.stringify(model.requests[0]!.messages)).toContain(`replace the whole of ${FILE}`);

  // The report, its sources beside it, and what Mobius wrote marked until kept.
  const report1 = page.getByRole('article', { name: 'Report' });
  await expect(report1.getByRole('heading', { name: 'Boutique hotels in Príncipe Real' })).toBeVisible();
  const sources = page.getByRole('complementary', { name: 'Sources' });
  await expect(sources.getByRole('link')).toHaveCount(1);
  await expect(sources.getByRole('link')).toContainText('Casa Amora');
  await expect(sources.getByRole('link')).toContainText('rooms and breakfast');
  // The count of sources sits in the window's toolbar, with Edit.
  await expect(shell.getByRole('group', { name: 'Report' })).toContainText('1 source · 1 fact marked from the web');
  // What Mobius did folds into one row; the fact is numbered as in Sources; and the next questions are offered.
  await expect(report1.locator('summary')).toHaveText('Read 1 source · 1 search');
  await expect(report1.getByRole('link', { name: /^Source 1: Casa Amora/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ask next' }).getByRole('button', { name: 'Is there parking nearby?' })).toBeVisible();
  await expect(report1.getByRole('heading', { name: 'Next questions' })).toBeHidden();
  await expect(report1).toContainText('Mobius wrote this report in its last turn.');
  await report1.getByRole('button', { name: 'Keep' }).click();
  await expect(report1).not.toContainText('in its last turn');

  // A follow-up goes with the report attached, and its change can be put back.
  await page.getByRole('textbox', { name: 'Ask a follow-up' }).fill('What about Porto?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(report1.getByRole('heading', { name: 'Porto' })).toBeVisible();
  const followUp = JSON.stringify(model.requests[4]!.messages);
  expect(followUp).toContain('What about Porto?');
  expect(followUp).toContain('Casa Amora is the closest fit');
  await expect(report1).toContainText('Mobius changed this report in its last turn.');
  await report1.getByRole('button', { name: 'Discard' }).click();
  await expect(report1.getByRole('heading', { name: 'Porto' })).toBeHidden();
  await expect.poll(() => fs.readFileSync(file, 'utf8')).not.toContain('Porto');
});

test('Research mode, from anywhere, turns the question into a Doc that Mobius fills with a cited report', async () => {
  const doc = 'docs/Research/Boutique hotels in Principe Real.md';
  const written = `# Boutique hotels in Príncipe Real\n\nCasa Amora is the closest fit: [nine rooms](${fixture.origin}/casa-amora) and breakfast included.\n\n## Sources\n\n- [Casa Amora](${fixture.origin}/casa-amora) — rooms and breakfast\n`;
  model = await startModel([
    callsTool('web-search', { query: 'boutique hotel Principe Real' }),
    callsTool('web-read', { url: `${fixture.origin}/casa-amora` }),
    callsTool('files-write', { path: doc, content: written }),
    says(['Casa Amora: nine rooms, breakfast included.']),
  ]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model', MOBIUS_WEB_SEARCH_URL: `${fixture.origin}/search/` } });
  const shell = mobius.shell;
  const box = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(box).toBeEnabled({ timeout: 15_000 });
  // Agent, Ask, Plan, then Research.
  await box.click();
  for (let i = 0; i < 3; i++) await box.press('Shift+Tab');
  await expect(shell.getByRole('button', { name: 'Mode: Research' })).toBeVisible();
  await box.fill('Boutique hotels in Principe Real?');
  await box.press('Enter');

  // Docs opens on the new report, which holds the question until Mobius writes it.
  const file = path.join(userData, 'workspace', ...doc.split('/'));
  await expect.poll(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8')).toContain('> Boutique hotels in Principe Real?');
  await expect(shell.locator('.doc-editor').getByRole('textbox', { name: 'Document text' })).toContainText('Boutique hotels in Principe Real');
  const log = shell.getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: web.search' }).getByRole('button', { name: 'Allow once' }).click();
  await log.getByRole('group', { name: 'Approval needed: web.read' }).getByRole('button', { name: 'Allow once' }).click();
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('breakfast included');
  const asked = (model.requests[0]!.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  expect(asked).toContain(`replace the whole of ${doc}`);
  // A Doc links each fact to its page: no Research-only citation marks.
  expect(asked).not.toContain('trust:web');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('## Sources');
});
