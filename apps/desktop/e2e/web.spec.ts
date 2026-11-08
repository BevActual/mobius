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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-web-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

test('Mobius searches the web and reads a page without opening a tab, asking first for each', async () => {
  model = await startModel([
    callsTool('web-search', { query: 'Lisbon boutique hotel Principe Real' }),
    callsTool('web-read', { url: `${fixture.origin}/casa-amora` }),
    says(['Casa Amora has nine rooms in Príncipe Real, breakfast included.']),
  ]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model', MOBIUS_WEB_SEARCH_URL: `${fixture.origin}/search/` } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  const tabsBefore = await shell.getByRole('tab').count();
  await composer.fill('Find a boutique hotel in Príncipe Real');
  await composer.press('Enter');
  const log = shell.getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: web.search' }).getByRole('button', { name: 'Allow once' }).click();
  await log.getByRole('group', { name: 'Approval needed: web.read' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('breakfast included');

  // What the tools gave the model: results with their real addresses, and the page as text without its script.
  const results = JSON.stringify(model.requests[1]!.messages);
  expect(results).toContain('Casa Amora · Lisbon boutique hotel Principe Real');
  expect(results).toContain('/casa-amora');
  const page = JSON.stringify(model.requests[2]!.messages);
  expect(page).toContain('Nine rooms in Príncipe Real.');
  expect(page).not.toContain('ignore()');
  expect(fixture.hits.some((h) => h.startsWith('/search/?q=Lisbon'))).toBe(true);
  expect(await shell.getByRole('tab').count()).toBe(tabsBefore);
});
