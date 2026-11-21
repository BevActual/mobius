import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';
import { startWebDav, type WebDavFixture } from './webdav-fixture';

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
// Where you are: the title, or inside a nested folder the breadcrumb's last part (the parts above open their folders).
const title = () => shell().locator('.strip-title .files-crumb[aria-current], .strip-title:not(:has(.files-title-path))');
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
  const page = shell().getByRole('region', { name: 'Files', exact: true });
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
  await expect(shell().locator('.strip-title .files-title-path')).toHaveText('Workspace›Notes›Work');
  await expect(shell().getByRole('complementary', { name: 'Places' }).getByRole('region', { name: 'Folders' }).getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');
  // The sidebar's search narrows the folder; the keyboard selects and opens.
  await shell().getByRole('searchbox', { name: 'Search this folder' }).fill('nothing like it');
  await expect(page).toContainText('Nothing here matches');
  await shell().getByRole('searchbox', { name: 'Search this folder' }).fill('pla');
  const plan = page.getByRole('row', { name: 'Plan.md', exact: true });
  await plan.click();
  await expect(plan).toContainText('Note');
  // Info, on the right, says what the picked file is and where it lives.
  await shell().getByRole('button', { name: 'Panels' }).click();
  await shell().getByRole('menuitemcheckbox', { name: 'Info' }).click();
  const info = shell().getByLabel('About Plan.md');
  await expect(info).toContainText('Note');
  await expect(info).toContainText('notes/Work');
  await plan.press('Enter');
  await expect(shell().getByRole('region', { name: 'Note: Plan' })).toBeVisible();
});

test('the keyboard stays on the list going into and out of folders, and Ctrl+F searches the folder', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Home'), { recursive: true });
  await start();
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files', exact: true });
  await page.getByRole('row', { name: 'notes', exact: true }).click();
  await shell().keyboard.press('Enter');
  await expect(title()).toHaveText('Notes');
  // In the folder, the keyboard is on its first row at once: Down moves to the next.
  const first = page.getByRole('row').nth(1);
  await expect(first).toBeFocused();
  await shell().keyboard.press('ArrowDown');
  await expect(page.getByRole('row').nth(2)).toBeFocused();
  // Back out, it is on the folder just left.
  await shell().keyboard.press('Backspace');
  await expect(page.getByRole('row', { name: 'notes', exact: true })).toBeFocused();
  await shell().keyboard.press('Control+f');
  await expect(shell().getByRole('searchbox', { name: 'Search this folder' })).toBeFocused();
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
  const side = shell().getByRole('complementary', { name: 'Places' });
  await side.getByRole('button', { name: /Made by Mobius/ }).click();
  const made = shell().getByRole('region', { name: 'Made by Mobius', exact: true });
  await expect(made.getByRole('option', { name: 'Work / Brief, from Mobius' })).toHaveAttribute('data-proposed');
  await side.getByRole('button', { name: 'Workspace' }).click();
  const page = shell().getByRole('region', { name: 'Files', exact: true });
  // A folder holding something from Mobius has an indigo dot here, and a count in the sidebar until it is looked in.
  await expect(page.getByRole('row', { name: 'notes, from Mobius' }).getByRole('img', { name: '1 from Mobius' })).toBeVisible();
  const notesSide = side.getByRole('region', { name: 'Folders' }).getByRole('button', { name: 'Notes' });
  await expect(notesSide.locator('.list-count')).toHaveText('1');
  await page.getByRole('row', { name: 'notes, from Mobius' }).dblclick();
  await expect(notesSide.locator('.list-count')).toHaveCount(0);
  await page.getByRole('row', { name: 'Work, from Mobius' }).dblclick();
  await expect(page.getByRole('row', { name: 'Brief.md, from Mobius' })).toHaveAttribute('data-proposed');
  await side.getByRole('button', { name: /Made by Mobius/ }).click();
  await made.getByRole('group', { name: "Mobius's change" }).getByRole('button', { name: 'Keep' }).click();
  await expect(made).toContainText('Nothing is waiting');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Brief.md'), 'utf8')).toContain('From Mobius.');
});

test('a file Mobius makes in the open folder shows dashed as the call lands, before the turn ends', async () => {
  // The answer comes slowly, so the turn is still running when the file is there.
  await start([
    callsTool('files-write', { path: 'notes/Work/Brief.md', content: '# Brief\n' }),
    says(['I wrote ', 'a brief.'], 3000),
  ]);
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files', exact: true });
  await page.getByRole('row', { name: 'notes', exact: true }).dblclick();
  await page.getByRole('row', { name: 'Work', exact: true }).dblclick();
  await expect(page.getByRole('row', { name: /^Plan\.md/ })).toBeVisible();
  await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'off' }));
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Write a brief');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await expect(page.getByRole('row', { name: 'Brief.md, from Mobius' })).toHaveAttribute('data-proposed');
  await expect(log.locator('.msg.assistant')).not.toHaveText('I wrote a brief.');
  await expect(log.locator('.msg.assistant')).toHaveText('I wrote a brief.', { timeout: 15_000 });
  await expect(page.getByRole('row', { name: 'Brief.md, from Mobius' })).toHaveAttribute('data-proposed');
});

test('a new folder is named in place, a file renamed with F2, and Delete moves it to the Trash with Undo', async () => {
  await start();
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files', exact: true });
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

test('a file dragged onto a folder moves into it with Undo, and Cut and Paste move one too', async () => {
  await start();
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files', exact: true });
  await page.getByRole('row', { name: 'notes', exact: true }).dblclick();
  await page.getByRole('row', { name: 'Work', exact: true }).dblclick();
  await tools().getByRole('button', { name: 'New folder' }).click();
  const naming = page.getByRole('textbox', { name: 'New name for New folder' });
  await naming.fill('Archive');
  await naming.press('Enter');
  const work = path.join(userData, 'workspace', 'notes', 'Work');

  // The drag as the webview sees it: start on the file, hover the folder, drop.
  const plan = page.getByRole('row', { name: 'Plan.md', exact: true });
  const archive = page.getByRole('row', { name: 'Archive', exact: true });
  const dataTransfer = await shell().evaluateHandle(() => new DataTransfer());
  await plan.dispatchEvent('dragstart', { dataTransfer });
  await archive.dispatchEvent('dragover', { dataTransfer });
  await expect(archive).toHaveAttribute('data-drop', 'true');
  await archive.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByRole('status')).toContainText('Moved “Plan.md” to Archive');
  await expect(plan).toHaveCount(0);
  expect(fs.readFileSync(path.join(work, 'Archive', 'Plan.md'), 'utf8')).toBe('# Plan\n');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(plan).toBeVisible();
  expect(fs.existsSync(path.join(work, 'Plan.md'))).toBe(true);

  // Cut here, Paste in the folder above.
  await plan.click();
  await plan.press('Control+x');
  await expect(plan).toHaveAttribute('data-cut', 'true');
  await page.getByRole('navigation', { name: 'Folder' }).getByRole('button', { name: 'notes' }).click();
  const workRow = page.getByRole('row', { name: 'Work', exact: true });
  await workRow.click();
  await workRow.press('Control+v');
  await expect(page.getByRole('row', { name: 'Plan.md', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Moved “Plan.md” to Notes');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Plan.md'), 'utf8')).toBe('# Plan\n');
});

test('the Trash lists what was trashed and where it was, puts it back there, and empties only after asking', async () => {
  await start();
  await openFiles();
  const page = shell().getByRole('region', { name: 'Files', exact: true });
  await page.getByRole('row', { name: 'notes', exact: true }).dblclick();
  await page.getByRole('row', { name: 'Work', exact: true }).dblclick();
  const plan = page.getByRole('row', { name: 'Plan.md', exact: true });
  await plan.click();
  await plan.press('Delete');
  await expect(plan).toHaveCount(0);

  const side = shell().getByRole('complementary', { name: 'Places' });
  await side.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(title()).toHaveText('Trash');
  const trash = shell().getByRole('region', { name: 'Trash', exact: true });
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

test('a drive on the person\'s own server: added from its address, browsed, and files copied both ways', async () => {
  let dav: WebDavFixture | undefined;
  try {
    dav = await startWebDav('ana', 'app-pass');
    dav.folders.add('Shared');
    dav.files.set('Shared/Budget.csv', { body: Buffer.from('Item,Cost\nVenue,900\n'), version: 1 });
    await start();
    await openFiles();
    const side = shell().getByRole('complementary', { name: 'Places' });
    await side.getByRole('button', { name: 'Add a drive' }).click();
    const form = shell().getByRole('form', { name: 'New drive' });
    // A wrong password is said plainly, and nothing is kept.
    await form.getByRole('textbox', { name: 'Server address', exact: true }).fill(dav.origin);
    await form.getByRole('textbox', { name: 'User name', exact: true }).fill('ana');
    await form.getByLabel('App password', { exact: true }).fill('wrong');
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Home cloud');
    await form.getByRole('button', { name: 'Add drive' }).click();
    await expect(form.getByRole('alert')).toContainText('did not accept');
    // The server's address alone is enough: Files finds Nextcloud's folder for the account.
    await form.getByLabel('App password', { exact: true }).fill('app-pass');
    await form.getByRole('button', { name: 'Add drive' }).click();
    const drive = shell().getByRole('region', { name: 'Home cloud drive' });
    await expect(drive.getByRole('row', { name: 'Shared', exact: true })).toBeVisible();
    await expect(side.getByRole('button', { name: 'Home cloud', exact: true })).toHaveAttribute('aria-current', 'page');

    // Browse into a folder, and drag its file out onto the workspace in the sidebar: a copy lands there.
    await drive.getByRole('row', { name: 'Shared', exact: true }).dblclick();
    await expect(title()).toHaveText('Shared');
    const budget = drive.getByRole('row', { name: 'Budget.csv', exact: true });
    await expect(budget).toContainText('CSV');
    const workspaceRow = side.getByRole('button', { name: 'Workspace', exact: true });
    let dataTransfer = await shell().evaluateHandle(() => new DataTransfer());
    await budget.dispatchEvent('dragstart', { dataTransfer });
    await workspaceRow.dispatchEvent('dragover', { dataTransfer });
    await expect(workspaceRow).toHaveAttribute('data-drop', 'true');
    await workspaceRow.dispatchEvent('drop', { dataTransfer });
    await expect(shell().getByRole('status').filter({ hasText: 'Copied “Budget.csv” to Workspace' })).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'Budget.csv'))).toBe(true);
    expect(fs.readFileSync(path.join(userData, 'workspace', 'Budget.csv'), 'utf8')).toBe('Item,Cost\nVenue,900\n');

    // A workspace file dragged onto the drive in the sidebar goes to the drive's top, never over one there.
    await workspaceRow.click();
    const files = shell().getByRole('region', { name: 'Files', exact: true });
    await files.getByRole('row', { name: 'notes', exact: true }).dblclick();
    await files.getByRole('row', { name: 'Work', exact: true }).dblclick();
    const driveRow = side.getByRole('button', { name: 'Home cloud', exact: true });
    dataTransfer = await shell().evaluateHandle(() => new DataTransfer());
    await files.getByRole('row', { name: 'Plan.md', exact: true }).dispatchEvent('dragstart', { dataTransfer });
    await driveRow.dispatchEvent('dragover', { dataTransfer });
    await expect(driveRow).toHaveAttribute('data-drop', 'true');
    await driveRow.dispatchEvent('drop', { dataTransfer });
    await expect(shell().getByRole('status').filter({ hasText: 'Copied “Plan.md” to Home cloud' })).toBeVisible();
    await expect.poll(() => dav!.files.get('Plan.md')?.body.toString()).toBe('# Plan\n');
    expect(fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Plan.md'))).toBe(true);

    // Someone changes the file on the server after Files listed it: Delete is refused, said plainly, and nothing is lost.
    await driveRow.click();
    await drive.getByRole('row', { name: 'Shared', exact: true }).dblclick();
    await expect(budget).toBeVisible();
    dav.touch('Shared/Budget.csv', 'Item,Cost\nVenue,950\n');
    await budget.click();
    await budget.press('Delete');
    await shell().getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(drive.getByRole('alert')).toContainText('changed on the server since Files listed it, so nothing was changed');
    expect(dav.files.get('Shared/Budget.csv')?.body.toString()).toBe('Item,Cost\nVenue,950\n');
  } finally {
    await dav?.close();
  }
});

test('a workspace folder synced with a drive: both ways, a sign-in that stopped working, and signing in again', async () => {
  const dav = await startWebDav('ana', 'app-pass');
  try {
    await start();
    type Bridge = { drives: { add(d: object): Promise<{ id: string }>; syncAdd(f: string, d: string, r: string): Promise<{ id: string }>; syncPairs(): Promise<{ id: string; status: { state: string } }[]>; signIn(id: string, p: string): Promise<{ ok: boolean }> } };
    const drive = await shell().evaluate((origin) => (window as unknown as { mobius: Bridge }).mobius.drives.add({ name: 'Cloud', server: origin, username: 'ana', password: 'app-pass' }), dav.origin);
    const pair = await shell().evaluate((id) => (window as unknown as { mobius: Bridge }).mobius.drives.syncAdd('notes', id, 'Notes'), drive.id);
    expect(pair.id).toBeTruthy();
    const local = path.join(userData, 'workspace', 'notes', 'Work', 'Plan.md');
    const there = (p: string) => dav.files.get(p)?.body.toString('utf8');
    // The first round sends the folder.
    await expect.poll(() => there('Notes/Work/Plan.md'), { timeout: 20_000 }).toBe('# Plan\n');
    // Someone changes it on the server: it comes in.
    dav.touch('Notes/Work/Plan.md', '# Plan\nFrom the server\n');
    await expect.poll(() => fs.readFileSync(local, 'utf8'), { timeout: 20_000 }).toBe('# Plan\nFrom the server\n');
    // An edit here goes out.
    fs.writeFileSync(local, '# Plan\nFrom here\n');
    await expect.poll(() => there('Notes/Work/Plan.md'), { timeout: 20_000 }).toBe('# Plan\nFrom here\n');
    // The app password is revoked: the pair says so and stops, until signing in again.
    dav.setPassword('new-pass');
    dav.touch('Notes/Work/Later.md', 'later');
    const state = () => shell().evaluate(() => (window as unknown as { mobius: Bridge }).mobius.drives.syncPairs()).then((p) => p[0]?.status.state);
    await expect.poll(state, { timeout: 20_000 }).toBe('signIn');
    expect(await shell().evaluate((id) => (window as unknown as { mobius: Bridge }).mobius.drives.signIn(id, 'wrong'), drive.id)).toMatchObject({ ok: false });
    expect(await shell().evaluate((id) => (window as unknown as { mobius: Bridge }).mobius.drives.signIn(id, 'new-pass'), drive.id)).toEqual({ ok: true });
    await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Later.md')), { timeout: 20_000 }).toBe(true);
    await expect.poll(state).toBe('idle');
  } finally {
    await dav.close();
  }
});

test('Files pairs a folder with a drive, says how its sync stands, pauses, signs in again and stops', async () => {
  const dav = await startWebDav('ana', 'app-pass');
  try {
    await start();
    await openFiles();
    const side = shell().getByRole('complementary', { name: 'Places' });
    await side.getByRole('button', { name: 'Add a drive' }).click();
    const form = shell().getByRole('form', { name: 'New drive' });
    await form.getByRole('textbox', { name: 'Server address', exact: true }).fill(dav.origin);
    await form.getByRole('textbox', { name: 'User name', exact: true }).fill('ana');
    await form.getByLabel('App password', { exact: true }).fill('app-pass');
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Cloud');
    await form.getByRole('button', { name: 'Add drive' }).click();
    await expect(shell().getByRole('region', { name: 'Cloud drive' })).toBeVisible();

    // Sync is off until the person pairs a folder: right-click it, Sync with a Drive…, Start syncing.
    await side.getByRole('button', { name: 'Workspace', exact: true }).click();
    const files = shell().getByRole('region', { name: 'Files', exact: true });
    await files.getByRole('row', { name: 'notes', exact: true }).click({ button: 'right' });
    await shell().getByRole('menuitem', { name: 'Sync with a Drive…' }).click();
    const dialog = shell().getByRole('dialog', { name: 'Sync Notes with a drive' });
    await expect(dialog.getByRole('textbox', { name: 'Folder on the drive' })).toHaveValue('Notes');
    await dialog.getByRole('button', { name: 'Start syncing' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => dav.files.get('Notes/Work/Plan.md')?.body.toString('utf8'), { timeout: 20_000 }).toBe('# Plan\n');

    // The synced folder wears the glyph, and its page says how it stands in the line under the title.
    await expect(side.getByRole('img', { name: /^Synced with Cloud/ })).toBeVisible();
    await files.getByRole('row', { name: 'notes', exact: true }).dblclick();
    const line = shell().locator('.sync-sub');
    await expect(line).toContainText('Up to date', { timeout: 20_000 });
    await tools().getByRole('button', { name: 'Pause syncing' }).click();
    await expect(line).toContainText('Paused');
    await tools().getByRole('button', { name: 'Resume syncing' }).click();
    await expect(line).toContainText('Up to date', { timeout: 20_000 });

    // The server stops taking the password: the line says so, and its link signs in again; what waited comes in.
    dav.setPassword('new-pass');
    dav.touch('Notes/Work/Later.md', 'later');
    const signIn = line.getByRole('button', { name: 'Sign in to Cloud again' });
    await expect(signIn).toBeVisible({ timeout: 20_000 });
    await expect(side.getByRole('img', { name: /^Synced with Cloud: Sign in/ })).toBeVisible();
    await signIn.click();
    const again = shell().getByRole('dialog', { name: 'Sign in to Cloud again' });
    await again.getByLabel('App password', { exact: true }).fill('new-pass');
    await again.getByRole('button', { name: 'Sign in' }).click();
    await expect(again).toHaveCount(0);
    await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Later.md')), { timeout: 20_000 }).toBe(true);
    await expect(line).toContainText('Up to date', { timeout: 20_000 });

    // Stop syncing asks first, and changes no files on either side.
    await side.getByRole('button', { name: 'Workspace', exact: true }).click();
    await files.getByRole('row', { name: 'notes', exact: true }).click({ button: 'right' });
    await shell().getByRole('menuitem', { name: 'Stop Syncing…' }).click();
    await shell().getByRole('alertdialog').getByRole('button', { name: 'Stop syncing' }).click();
    await expect(side.getByRole('img', { name: /^Synced with Cloud/ })).toHaveCount(0);
    expect(dav.files.get('Notes/Work/Plan.md')?.body.toString('utf8')).toBe('# Plan\n');
    expect(fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Plan.md'))).toBe(true);
  } finally {
    await dav.close();
  }
});
