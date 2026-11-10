import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Notes is built in the Tauri shell');

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-notes-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

async function start(replies: ModelReply[] = []): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell().keyboard.press('Enter');
  await expect(side()).toBeVisible();
  return mobius;
}
const shell = () => mobius!.shell;
const side = (): Locator => shell().getByRole('complementary', { name: 'Notes sidebar' });
/** The page as formatted text; `source()` is the Markdown view, the file itself in a text box. */
const text = (): Locator => shell().getByRole('textbox', { name: 'Note text' });
const source = (): Locator => shell().getByRole('textbox', { name: 'Page text' });
const format = (): Locator => shell().getByRole('toolbar', { name: 'Format' });
const status = (): Locator => shell().locator('.note-status');
const file = (...parts: string[]) => path.join(userData, 'workspace', 'notes', ...parts);
const onDisk = (...parts: string[]) => fs.readFileSync(file(...parts), 'utf8');
const newNotebook = async (name: string) => {
  await side().getByRole('button', { name: 'New notebook' }).first().click();
  await side().getByRole('textbox', { name: 'Notebook name' }).fill(name);
  await side().getByRole('button', { name: 'Create' }).click();
};
/** Types over the page's title. */
const retitle = async (title: string) => {
  await text().locator('h1').click();
  await shell().keyboard.press('End');
  await shell().keyboard.press('Shift+Home');
  await shell().keyboard.type(title);
};

test('a first notebook and page are real files, and typing is saved as Markdown', async () => {
  await start();
  await expect(side().getByText('Pages are kept as Markdown files')).toBeVisible();
  await newNotebook('Work');
  await expect(text()).toBeFocused();
  await expect(text().locator('h1')).toHaveText('Untitled');
  expect(onDisk('Work', 'Untitled.md')).toBe('# Untitled\n\n');
  await retitle('Launch plan');
  await shell().keyboard.press('End');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('Ship Notes this week.');
  await expect(status()).toHaveText('Saved');
  await expect.poll(() => onDisk('Work', 'Untitled.md')).toBe('# Launch plan\n\nShip Notes this week.\n');
  // The list and the top strip take the title from the first heading; the row says how the page starts.
  await expect(side().getByRole('button', { name: 'Launch plan', exact: true })).toBeVisible();
  await expect(side().getByRole('button', { name: 'Launch plan', exact: true })).toContainText('Ship Notes this week.');
  await expect(shell().locator('.strip-title')).toHaveText('Launch plan');
});

test('pages survive a restart, search finds them, and a deleted page is gone from disk', async () => {
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Home', 'Groceries.md'), '# Groceries\n- oat milk\n');
  fs.writeFileSync(file('Home', 'Garden.md'), '# Garden\n- tomatoes\n');
  await start();
  await side().getByRole('button', { name: 'Garden', exact: true }).click();
  await expect(text().locator('h1')).toHaveText('Garden');
  await expect(text().locator('li')).toHaveText(['tomatoes']);
  await side().getByRole('searchbox', { name: 'Search notes' }).fill('oat');
  const results = side().getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Groceries/ }).click();
  await expect(text().locator('h1')).toHaveText('Groceries');
  await side().getByRole('searchbox', { name: 'Search notes' }).fill('');
  await side().getByRole('button', { name: 'Delete Groceries' }).click();
  await side().getByRole('button', { name: 'Confirm delete Groceries' }).click();
  await expect(side().getByRole('button', { name: 'Groceries', exact: true })).toHaveCount(0);
  expect(fs.existsSync(file('Home', 'Groceries.md'))).toBe(false);
  // Opening a page does not rewrite it: the file stays as it was written.
  expect(onDisk('Home', 'Garden.md')).toBe('# Garden\n- tomatoes\n');
  await expect(shell().getByText('Choose a page, or make a new one.')).toBeVisible();
});

test('the agent panel sits beside a note, and a change the agent makes shows up in the open page', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n- one\n');
  await start([callsTool('files-edit', { path: 'notes/Work/Plan.md', old: '- one', new: '- one\n- two' }), says(['Added it.'])]);
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text().locator('li')).toHaveText(['one']);
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeVisible();
  await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'off' }));
  await shell().getByRole('textbox', { name: 'Message Mobius' }).fill('add two');
  await shell().getByRole('textbox', { name: 'Message Mobius' }).press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant').last()).toHaveText('Added it.');
  await expect(text().locator('li')).toHaveText(['one', 'two']);
});

test('if the agent changes the page while the person is typing, nothing is lost and the person chooses', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n');
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text().locator('h1')).toHaveText('Plan');
  // The window has not saved yet when the change lands: simulate by holding the save back.
  await shell().evaluate(() => {
    const notes = window.mobius.notes!;
    const real = notes.save;
    (window as unknown as { releaseSave: () => void }).releaseSave = () => { notes.save = real; };
    notes.save = () => new Promise(() => {});
  });
  await text().locator('h1').click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(' mine');
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\nfrom the agent\n');
  await mobius!.shell.evaluate(() => (window as unknown as { releaseSave: () => void }).releaseSave());
  // The disk change comes from outside Mobius here, so ask the editor to save; the stale save is refused.
  await shell().keyboard.type('!');
  await expect(shell().getByRole('alert')).toContainText('changed this page');
  await expect(text().locator('h1')).toHaveText('Plan mine!');
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan\nfrom the agent\n');
  await shell().getByRole('button', { name: 'Keep mine' }).click();
  await expect(status()).toHaveText('Saved');
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan mine!\n');
});

test('the format bar makes a checklist you tick, and Insert clips a web page where the cursor is', async () => {
  await start();
  await newNotebook('Trip');
  await retitle('Offsite');
  await shell().keyboard.press('End');
  await shell().keyboard.press('Enter');
  await format().getByRole('button', { name: 'Checklist' }).click();
  await shell().keyboard.type('Book flights');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('Pack');
  await expect.poll(() => onDisk('Trip', 'Untitled.md')).toBe('# Offsite\n\n- [ ] Book flights\n- [ ] Pack\n');
  // Ticking a box is saved as [x], and the item shows as done.
  await text().getByRole('checkbox', { name: 'Task item checkbox for Book flights' }).check();
  await expect.poll(() => onDisk('Trip', 'Untitled.md')).toBe('# Offsite\n\n- [x] Book flights\n- [ ] Pack\n');
  // Out of the list (Enter on an empty item), then a clipped page goes in where the cursor is.
  await text().getByText('Pack', { exact: true }).click();
  await shell().keyboard.press('End');
  await shell().keyboard.press('Enter');
  await shell().keyboard.press('Enter');
  const insert = format().getByRole('group', { name: 'Insert' });
  await insert.getByRole('button', { name: 'Clip from web' }).click();
  await format().getByRole('textbox', { name: 'Address to clip' }).fill(`${fixture.origin}/casa-amora`);
  await format().getByRole('button', { name: 'Clip', exact: true }).click();
  await expect(text().locator('blockquote')).toContainText('Nine rooms in Príncipe Real.');
  await expect(text().getByRole('link', { name: 'Casa Amora' })).toBeVisible();
  await expect(status()).toHaveText('Saved');
  await expect.poll(() => onDisk('Trip', 'Untitled.md')).toMatch(/- \[ \] Pack\n\n> Nine rooms in Príncipe Real\.\n>\n> Breakfast included\.\n\n— \[Casa Amora\]\(/);
});

test('#tags in pages show under Tags, and a tag lists the pages that carry it', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Work', 'Packs.md'), '# Packs\n\nVeltro holds the price until Friday. #supplier #kestrel/p2\n');
  fs.writeFileSync(file('Work', 'Motors.md'), '# Motors\n\nAxion quote #Supplier\n');
  fs.writeFileSync(file('Home', 'Garden.md'), '# Garden\n\nTomatoes, not a #2 tag.\n');
  await start();
  const tags = side().getByRole('treeitem', { name: 'Tags' });
  // The section's rows (not its fold button); a tag written in two cases is one tag, with its first spelling.
  await expect(tags.getByRole('group').getByRole('button')).toHaveText(['#kestrel/p21', /^#supplier2$/i]);
  // Each row says how its page starts.
  await expect(side().getByRole('button', { name: 'Packs', exact: true })).toContainText('Veltro holds the price');
  await tags.getByRole('button', { name: /^#supplier, 2 pages$/i }).click();
  const tagged = side().getByRole('list', { name: /^Pages tagged supplier$/i });
  // One row per page (each row also has its pin and delete buttons).
  await expect(tagged.getByRole('listitem')).toHaveCount(2);
  await tagged.getByRole('button', { name: 'Packs', exact: true }).click();
  // The tags are marked in the page, and listed under its title.
  await expect(text().locator('.note-tag')).toHaveText(['#supplier', '#kestrel/p2']);
  await shell().locator('.note-meta').getByRole('button', { name: '#kestrel/p2' }).click();
  await expect(side().getByRole('list', { name: 'Pages tagged kestrel/p2' }).getByRole('listitem')).toHaveCount(1);
  await side().getByRole('button', { name: 'Show every page' }).click();
  await expect(side().getByRole('treeitem', { name: 'Work' })).toBeVisible();
});

test('the Markdown view shows the file as it is kept, and typing there is saved', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n\n- [ ] Call Sam\n');
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text().getByRole('checkbox', { name: 'Task item checkbox for Call Sam' })).not.toBeChecked();
  await format().getByRole('button', { name: 'Markdown' }).click();
  await expect(source()).toHaveValue('# Plan\n\n- [ ] Call Sam\n');
  await source().press('Control+End');
  await source().pressSequentially('- [x] Book the sled\n');
  await expect(status()).toHaveText('Saved');
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan\n\n- [ ] Call Sam\n- [x] Book the sled\n');
  // Back to the formatted page, which shows what was typed; the choice is kept for the next page.
  await format().getByRole('button', { name: 'Markdown' }).click();
  await expect(text().getByRole('checkbox', { name: 'Task item checkbox for Book the sled' })).toBeChecked();
});

test('a pinned page is listed first, under Pinned, as well as in its notebook', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Packs.md'), '# Packs\n');
  fs.writeFileSync(file('Work', 'Motors.md'), '# Motors\n');
  await start();
  await expect(side().getByRole('treeitem', { name: 'Pinned' })).toHaveCount(0);
  await side().getByRole('button', { name: 'Pin Motors to the sidebar' }).click();
  const pinned = side().getByRole('treeitem', { name: 'Pinned' });
  await expect(pinned.getByRole('button', { name: 'Motors', exact: true })).toBeVisible();
  await expect(side().getByRole('treeitem', { name: 'Work' }).getByRole('button', { name: 'Motors', exact: true })).toBeVisible();
  await pinned.getByRole('button', { name: 'Unpin Motors' }).click();
  await expect(side().getByRole('treeitem', { name: 'Pinned' })).toHaveCount(0);
});
