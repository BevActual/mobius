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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-reader-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

test('a link is kept as just its words, read with Mobius, and archived when done', async () => {
  model = await startModel([says(['Casa Amora: nine rooms in Príncipe Real, breakfast included.'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  await expect(shell.getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Reader');
  await shell.keyboard.press('Enter');

  const page = shell.getByRole('region', { name: 'Reader' });
  await page.getByRole('textbox', { name: 'Link to save' }).fill(`${fixture.origin}/casa-amora`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const article = page.getByRole('article', { name: 'Article' });
  await expect(article.getByRole('heading', { name: 'Casa Amora', level: 1 })).toBeVisible();
  await expect(article).toContainText('Nine rooms in Príncipe Real.');
  await expect(article).toContainText('Breakfast included.');
  await expect(article).not.toContainText('ignore()');
  // The article's own controls sit in the window's toolbar; when it was saved and how long it is, above its title.
  const bar = shell.getByRole('group', { name: 'Reader' });
  await expect(article).toContainText('Saved today · 1 min read');
  const file = path.join(userData, 'workspace', 'reading', 'Reading list', 'Casa Amora.md');
  const kept = fs.readFileSync(file, 'utf8');
  expect(kept).toContain(`(${fixture.origin}/casa-amora) · saved `);
  // The page's own heading is not repeated under the title.
  expect(kept.match(/Casa Amora/g)?.length).toBe(1);

  // Aa: larger text and a sepia page, remembered on this computer.
  await bar.getByRole('button', { name: 'Text and page' }).click();
  const look = shell.getByRole('dialog', { name: 'Text and page' });
  await look.getByRole('button', { name: 'Larger' }).click();
  await expect(article).toHaveAttribute('data-size', 'l');
  await look.getByRole('button', { name: 'Sepia' }).click();
  await expect(page).toHaveAttribute('data-theme', 'sepia');
  await look.press('Escape');
  await expect(look).toBeHidden();

  // Mobius reads along: the article goes with the request. Mobius has its own panel; Highlights waits in the inspector.
  await shell.getByRole('button', { name: 'Summarise this' }).click();
  await expect(shell.getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toContainText('breakfast included');
  expect(JSON.stringify(model.requests[0]!.messages)).toContain('Nine rooms in Príncipe Real.');

  // A passage selected and highlighted is marked in the article and listed under it.
  const passage = article.getByText('Breakfast included.');
  await passage.selectText();
  await passage.dispatchEvent('mouseup');
  await article.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: /Highlight/ }).click();
  await expect(article.locator('mark')).toHaveText('Breakfast included.');
  // Highlights collect in their own panel in the inspector, shown from the Panels menu.
  await shell.getByRole('button', { name: 'Panels' }).click();
  await shell.getByRole('menuitem', { name: 'Highlights' }).click();
  await expect(shell.getByRole('region', { name: 'Highlights' })).toContainText('Breakfast included.');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('==Breakfast included.==');

  // Ask Mobius about a passage: the message starts with it quoted, ready to finish.
  const other = article.getByText('Nine rooms in Príncipe Real.');
  await other.selectText();
  await other.dispatchEvent('mouseup');
  await article.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: 'Ask Mobius' }).click();
  await expect(shell.getByRole('tab', { name: 'Mobius' })).toHaveCount(0);
  await expect(shell.getByRole('textbox', { name: 'Message Mobius' })).toHaveValue(/> Nine rooms in Príncipe Real\./);

  await bar.getByRole('button', { name: 'Done reading' }).click();
  await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'reading', 'Archive', 'Casa Amora.md'))).toBe(true);
  await expect.poll(() => fs.existsSync(file)).toBe(false);
  await expect(bar.getByRole('button', { name: 'Done reading' })).toBeHidden();
  // Undo puts it back in the reading list; done again, it stays archived.
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  await expect(bar.getByRole('button', { name: 'Done reading' })).toBeVisible();
  await bar.getByRole('button', { name: 'Done reading' }).click();
  await expect.poll(() => fs.existsSync(file)).toBe(false);

  // The link field shows only when asked for while an article is open. A page that cannot be read says so.
  await expect(page.getByRole('textbox', { name: 'Link to save' })).toBeHidden();
  await bar.getByRole('button', { name: 'Save a link' }).click();
  await page.getByRole('textbox', { name: 'Link to save' }).fill(`${fixture.origin}/fav.png`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That page could not be saved');
});
