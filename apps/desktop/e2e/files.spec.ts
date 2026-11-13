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
/** The toolbar's title: the open folder's name. */
const title = () => shell().locator('.strip-title');
/** Files' own controls, in the toolbar. */
const tools = () => shell().getByRole('group', { name: 'Files' });

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
  // As in Finder: a click selects, a double-click opens.
  const notes = page.getByRole('row', { name: 'notes', exact: true });
  await notes.click();
  await expect(notes).toHaveAttribute('aria-selected', 'true');
  await expect(notes).toContainText('Notes folder');
  await notes.dblclick();
  await expect(title()).toHaveText('Notes');
  await page.getByRole('row', { name: 'Work', exact: true }).dblclick();
  await expect(page.getByRole('navigation', { name: 'Folder' })).toHaveText('Workspace › notes › Work');
  // Back and Forward, in the toolbar, walk the folders visited; the sidebar lists the workspace's folders.
  await tools().getByRole('button', { name: 'Back' }).click();
  await expect(title()).toHaveText('Notes');
  await tools().getByRole('button', { name: 'Forward' }).click();
  await expect(title()).toHaveText('Work');
  await expect(shell().getByRole('complementary', { name: 'Files sidebar' }).getByRole('region', { name: 'Folders' }).getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');
  // The sidebar's search narrows the folder; the keyboard selects and opens.
  await shell().getByRole('searchbox', { name: 'Search this folder' }).fill('nothing like it');
  await expect(page).toContainText('Nothing here matches');
  await shell().getByRole('searchbox', { name: 'Search this folder' }).fill('pla');
  const plan = page.getByRole('row', { name: 'Plan.md', exact: true });
  await plan.click();
  await expect(plan).toContainText('Note');
  await plan.press('Enter');
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
  const side = shell().getByRole('complementary', { name: 'Files sidebar' });
  await side.getByRole('button', { name: /Made by Mobius/ }).click();
  const made = shell().getByRole('region', { name: 'Made by Mobius' });
  await expect(made.getByRole('option', { name: 'Work / Brief, from Mobius' })).toHaveAttribute('data-proposed');
  await side.getByRole('button', { name: 'Workspace' }).click();
  const page = shell().getByRole('region', { name: 'Files' });
  await expect(page.getByRole('row', { name: 'notes, from Mobius' })).toContainText('1 from Mobius');
  await page.getByRole('row', { name: 'notes, from Mobius' }).dblclick();
  await page.getByRole('row', { name: 'Work, from Mobius' }).dblclick();
  await expect(page.getByRole('row', { name: 'Brief.md, from Mobius' })).toHaveAttribute('data-proposed');
  await side.getByRole('button', { name: /Made by Mobius/ }).click();
  await made.getByRole('group', { name: "Mobius's change" }).getByRole('button', { name: 'Keep' }).click();
  await expect(made).toContainText('Nothing is waiting');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Brief.md'), 'utf8')).toContain('From Mobius.');
});

test('a new folder is named in place, a file renamed with F2, and Delete moves it to the Trash with Undo', async () => {
  await start();
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files' });
  await page.getByRole('row', { name: 'notes', exact: true }).dblclick();
  await page.getByRole('row', { name: 'Work', exact: true }).dblclick();
  await tools().getByRole('button', { name: 'New folder' }).click();
  const naming = page.getByRole('textbox', { name: 'New name for New folder' });
  await naming.fill('Battery');
  await naming.press('Enter');
  await expect(page.getByRole('row', { name: 'Battery', exact: true })).toBeVisible();
  expect(fs.statSync(path.join(userData, 'workspace', 'notes', 'Work', 'Battery')).isDirectory()).toBe(true);

  const plan = page.getByRole('row', { name: 'Plan.md', exact: true });
  await plan.click();
  await plan.press('F2');
  const renaming = page.getByRole('textbox', { name: 'New name for Plan.md' });
  await renaming.fill('Build plan.md');
  await renaming.press('Enter');
  const renamed = page.getByRole('row', { name: 'Build plan.md', exact: true });
  await expect(renamed).toBeVisible();
  expect(fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Build plan.md'))).toBe(true);

  await renamed.click();
  await renamed.press('Delete');
  await expect(page.getByRole('status')).toContainText('Moved “Build plan.md” to the Trash');
  await expect(renamed).toHaveCount(0);
  expect(fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Build plan.md'))).toBe(false);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(renamed).toBeVisible();
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Build plan.md'), 'utf8')).toBe('# Plan\n');

  // An app's own folder cannot be renamed or thrown away from Files.
  await tools().getByRole('button', { name: 'Back' }).click();
  await tools().getByRole('button', { name: 'Back' }).click();
  await page.getByRole('row', { name: 'notes', exact: true }).click({ button: 'right' });
  const menu = shell().getByRole('menu', { name: 'notes' });
  await expect(menu.getByRole('menuitem', { name: 'Open' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Rename|Move to Trash/ })).toHaveCount(0);
});

test('the Trash lists what was trashed and where it was, puts it back there, and empties only after asking', async () => {
  await start();
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files' });
  await page.getByRole('row', { name: 'notes', exact: true }).dblclick();
  await page.getByRole('row', { name: 'Work', exact: true }).dblclick();
  const plan = page.getByRole('row', { name: 'Plan.md', exact: true });
  await plan.click();
  await plan.press('Delete');
  await expect(plan).toHaveCount(0);

  const side = shell().getByRole('complementary', { name: 'Files sidebar' });
  await side.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(title()).toHaveText('Trash');
  const trash = shell().getByRole('region', { name: 'Trash' });
  const held = trash.getByRole('row', { name: 'Plan.md', exact: true });
  await expect(held).toContainText('Notes › Work');
  await held.click();
  await tools().getByRole('button', { name: 'Put Back' }).click();
  await expect(trash).toContainText('The Trash is empty');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Plan.md'), 'utf8')).toBe('# Plan\n');

  // Gone for good only after saying so: Cancel keeps it, Delete empties the Trash.
  await side.getByRole('button', { name: 'Workspace' }).click();
  await page.getByRole('row', { name: 'notes', exact: true }).dblclick();
  await page.getByRole('row', { name: 'Work', exact: true }).dblclick();
  await page.getByRole('row', { name: 'Plan.md', exact: true }).click();
  await page.getByRole('row', { name: 'Plan.md', exact: true }).press('Delete');
  await side.getByRole('button', { name: 'Trash', exact: true }).click();
  await tools().getByRole('button', { name: 'Empty Trash…' }).click();
  const ask = trash.getByRole('alertdialog', { name: 'Delete for good?' });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(trash.getByRole('row', { name: 'Plan.md', exact: true })).toBeVisible();
  await tools().getByRole('button', { name: 'Empty Trash…' }).click();
  await ask.getByRole('button', { name: 'Delete' }).click();
  await expect(trash).toContainText('The Trash is empty');
  expect(fs.readdirSync(path.join(userData, 'workspace', '.trash')).filter((n) => !n.startsWith('.'))).toEqual([]);
});
