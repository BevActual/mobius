import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goTo, launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
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
const side = (): Locator => shell().getByRole('complementary', { name: 'Notebooks' });
/** The page as formatted text; `source()` is the Markdown view, the file itself in a text box. */
const text = (): Locator => shell().getByRole('textbox', { name: 'Note text' });
const source = (): Locator => shell().getByRole('textbox', { name: 'Page text' });
const format = (): Locator => shell().getByRole('toolbar', { name: 'Format' });
/** Chooses an item in the Notes menu, under the toolbar's Menu button. */
const notesMenu = async (item: string): Promise<void> => {
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'Notes', exact: true }).click();
  await shell().getByRole('menu', { name: 'Notes' }).getByRole('menuitem', { name: item }).click();
};
const viewMenu = async (item: string): Promise<void> => {
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'View', exact: true }).click();
  await shell().getByRole('menu', { name: 'View' }).getByRole('menuitem', { name: item }).click();
};
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
  await expect(side().getByText('No notes yet.')).toBeVisible();
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
  // The list takes the title from the first heading, and the row says how the page starts; the top strip says Notes,
  // with the notebook beside it.
  await expect(side().getByRole('button', { name: 'Launch plan', exact: true })).toBeVisible();
  await expect(side().getByRole('button', { name: 'Launch plan', exact: true })).toContainText('Ship Notes this week.');
  await expect(shell().locator('.strip-title')).toHaveText('Notes');
  await expect(shell().locator('.toolbar-sub')).toContainText('Work');
});

test('pages survive a restart, search finds them, and a deleted page is gone from disk', async () => {
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Home', 'Groceries.md'), '# Groceries\n- oat milk\n');
  fs.writeFileSync(file('Home', 'Garden.md'), '# Garden\n- tomatoes\n');
  // A page written on Windows: line endings \r\n, and headings with no blank line under them.
  const SUPPLIERS = '# Suppliers\r\n## Veltro\r\n- packs in six weeks\r\n## Axion\r\n- motors\r\n';
  fs.writeFileSync(file('Home', 'Suppliers.md'), SUPPLIERS);
  await start();
  await side().getByRole('button', { name: 'Suppliers', exact: true }).click();
  await expect(text().locator('h2')).toHaveText(['Veltro', 'Axion']);
  await side().getByRole('button', { name: 'Garden', exact: true }).click();
  await expect(text().locator('h1')).toHaveText('Garden');
  await expect(text().locator('li')).toHaveText(['tomatoes']);
  // Coming back to Notes opens the same page again: that does not rewrite it either (checked at the end).
  await goTo(shell(), 'Tasks');
  await goTo(shell(), 'Notes');
  await expect(text().locator('li')).toHaveText(['tomatoes']);
  await side().getByRole('searchbox', { name: 'Search notes' }).fill('oat');
  const results = side().getByRole('region', { name: 'Results' });
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Groceries/ }).click();
  await expect(text().locator('h1')).toHaveText('Groceries');
  await side().getByRole('searchbox', { name: 'Search notes' }).fill('');
  // Delete is in the row's menu, and goes to the Trash, so it asks nothing more.
  await side().getByRole('button', { name: 'Groceries', exact: true }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Groceries' }).getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(side().getByRole('button', { name: 'Groceries', exact: true })).toHaveCount(0);
  expect(fs.existsSync(file('Home', 'Groceries.md'))).toBe(false);
  // Opening a page does not rewrite it: the file stays as it was written.
  expect(onDisk('Home', 'Garden.md')).toBe('# Garden\n- tomatoes\n');
  expect(onDisk('Home', 'Suppliers.md')).toBe(SUPPLIERS);
  await expect(shell().getByRole('region', { name: 'No note open' })).toBeVisible();
});

test('Ctrl+Z takes back what was typed and stops there: never the page as it was before it opened', async () => {
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Home', 'Groceries.md'), '# Groceries\n- oat milk\n');
  fs.writeFileSync(file('Home', 'Garden.md'), '# Garden\n- tomatoes\n');
  await start();
  await side().getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(text().locator('h1')).toHaveText('Groceries');
  await side().getByRole('button', { name: 'Garden', exact: true }).click();
  await expect(text().locator('h1')).toHaveText('Garden');
  await text().locator('li').click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(' and basil');
  await expect.poll(() => onDisk('Home', 'Garden.md')).toContain('tomatoes and basil');
  for (let i = 0; i < 8; i++) await shell().keyboard.press('Control+z');
  await expect(text().locator('li')).toHaveText(['tomatoes']);
  await expect(text().locator('h1')).toHaveText('Garden');
  await expect.poll(() => onDisk('Home', 'Garden.md')).not.toContain('basil');
  expect(onDisk('Home', 'Garden.md')).toMatch(/^# Garden\n+- tomatoes\n$/);
  expect(onDisk('Home', 'Groceries.md')).toBe('# Groceries\n- oat milk\n');
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

test('a note written in another app keeps its front matter, footnotes, HTML and links when it is edited here', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  const before = '---\ntitle: Plan\ntags: [launch]\n---\n\n# Plan\n\nBody text.[^1] See [the brief](<Launch brief.md>).\n\n<details>\n<summary>More</summary>\n\nHidden\n\n</details>\n\nPress <kbd>Ctrl</kbd> to start.\n\n[^1]: The source.\n';
  fs.writeFileSync(file('Work', 'Plan.md'), before);
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text().locator('p', { hasText: 'Body text.' })).toBeVisible();
  // The list shows how the note starts, not its front matter.
  await expect(side().getByRole('button', { name: 'Plan', exact: true })).not.toContainText('title:');
  await text().locator('p', { hasText: 'Press' }).click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(' Then go.');
  await expect(status()).toHaveText('Saved');
  await expect.poll(() => onDisk('Work', 'Plan.md')).toBe(before.replace('to start.', 'to start. Then go.'));
});

test('a change Mobius makes to the open page is marked as it lands, and its Keep comes when the turn ends', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n\nOne thing.\n');
  // The answer comes slowly, so the turn is still running when the page has changed.
  await start([callsTool('files-edit', { path: 'notes/Work/Plan.md', old: 'One thing.', new: 'One thing.\n\nAnother thing.' }), says(['Added ', 'it.'], 3000)]);
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text()).toContainText('One thing.');
  await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'off' }));
  await shell().getByRole('textbox', { name: 'Message Mobius' }).fill('add another');
  await shell().getByRole('textbox', { name: 'Message Mobius' }).press('Enter');
  const added = shell().getByRole('group', { name: 'Words Mobius added' });
  await expect(added).toBeVisible();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant').last()).not.toHaveText('Added it.');
  await expect(added.getByRole('button', { name: 'Keep this change' })).toHaveCount(0);
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant').last()).toHaveText('Added it.', { timeout: 15_000 });
  await expect(shell().getByRole('group', { name: 'Words Mobius added' }).getByRole('button', { name: 'Keep this change' })).toBeVisible();
});

test('if the agent changes the page while the person is typing, nothing is lost and the person chooses', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n');
  fs.writeFileSync(file('Work', 'Other.md'), '# Other\n');
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
  await expect(shell().getByRole('alert')).toContainText('changed this note');
  await expect(text().locator('h1')).toHaveText('Plan mine!');
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan\nfrom the agent\n');
  // Another page waits until the person has chosen: leaving now would drop what they typed.
  await side().getByRole('button', { name: 'Other', exact: true }).click();
  await expect(status()).toHaveText('Choose Keep mine or Use their version first.');
  await expect(text().locator('h1')).toHaveText('Plan mine!');
  await shell().getByRole('button', { name: 'Keep mine' }).click();
  // Once saved, the status line says so again, not the earlier message.
  await expect(status()).toHaveText('Saved');
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan mine!\n');
});

test('the format bar makes a checklist you tick, and More clips a web page where the cursor is', async () => {
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
  // Clipping is in the Notes menu (Menu in the toolbar).
  await notesMenu('Clip a web page…');
  await shell().getByRole('textbox', { name: 'Address to clip' }).fill(`${fixture.origin}/casa-amora`);
  await shell().getByRole('button', { name: 'Clip', exact: true }).click();
  await expect(text().locator('blockquote')).toContainText('Nine rooms in Príncipe Real.');
  await expect(text().getByRole('link', { name: 'Casa Amora' })).toBeVisible();
  await expect(status()).toHaveText('Saved');
  await expect.poll(() => onDisk('Trip', 'Untitled.md')).toMatch(/- \[ \] Pack\n\n> Nine rooms in Príncipe Real\.\n>\n> Breakfast included\.\n\n— \[Casa Amora\]\(/);
});

test('the centred tool row sets the text style and bold, and undo takes it back', async () => {
  await start();
  await newNotebook('Ideas');
  await retitle('Garden');
  await shell().keyboard.press('End');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('Beds');
  await format().getByRole('button', { name: 'Text style: Body' }).click();
  await shell().getByRole('menu', { name: 'Text style' }).getByRole('menuitemcheckbox', { name: 'Heading', exact: true }).click();
  await shell().keyboard.press('Escape');
  await expect(format().getByRole('button', { name: 'Text style: Heading' })).toBeVisible();
  await expect.poll(() => onDisk('Ideas', 'Untitled.md')).toBe('# Garden\n\n## Beds\n');
  await format().getByRole('button', { name: 'Undo' }).click();
  await expect(format().getByRole('button', { name: 'Text style: Heading' })).toHaveCount(0);
  await expect.poll(() => onDisk('Ideas', 'Untitled.md')).not.toContain('## ');
});

test('typing "[ ] " at the start of a bullet makes that bullet a checklist item, as in other notes apps', async () => {
  await start();
  await newNotebook('Home');
  await retitle('Shop');
  await shell().keyboard.press('End');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('- Milk');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('[ ] Call the bakery');
  await expect(text().getByRole('checkbox', { name: 'Task item checkbox for Call the bakery' })).toBeVisible();
  // The bullet before it stays a bullet.
  await expect.poll(() => onDisk('Home', 'Untitled.md')).toBe('# Shop\n\n- Milk\n\n- [ ] Call the bakery\n');
  // Ctrl+N, from the page, starts another one (it presses New note in the Notebooks panel).
  await shell().keyboard.press('Control+n');
  await expect(text().locator('h1')).toHaveText('Untitled');
  await expect(side().getByRole('button', { name: /^Shop/ })).toBeVisible();
});

test('#tags in pages show under Tags, and a tag lists the pages that carry it', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Work', 'Packs.md'), '# Packs\n\nVeltro holds the price until Friday. #supplier #kestrel/p2\n');
  fs.writeFileSync(file('Work', 'Motors.md'), '# Motors\n\nAxion quote #Supplier\n');
  fs.writeFileSync(file('Home', 'Garden.md'), '# Garden\n\nTomatoes, not a #2 tag.\n');
  await start();
  const tags = side().getByRole('region', { name: 'Tags' });
  // The section's rows (not its fold button); a tag written in two cases is one tag, with its first spelling.
  await expect(tags.getByRole('list').getByRole('button')).toHaveText(['#kestrel/p21', /^#supplier2$/i]);
  // Each row says how its page starts.
  await expect(side().getByRole('button', { name: 'Packs', exact: true })).toContainText('Veltro holds the price');
  await tags.getByRole('button', { name: /^#supplier/i }).click();
  const tagged = side().getByRole('region', { name: /^#supplier$/i });
  // One row per page (each row also has its pin and delete buttons).
  await expect(tagged.getByRole('listitem')).toHaveCount(2);
  await tagged.getByRole('button', { name: 'Packs', exact: true }).click();
  // The tags are marked in the page, and listed under its title.
  await expect(text().locator('.note-tag')).toHaveText(['#supplier', '#kestrel/p2']);
  await shell().locator('.note-meta').getByRole('button', { name: '#kestrel/p2' }).click();
  await expect(side().getByRole('region', { name: '#kestrel/p2' }).getByRole('listitem')).toHaveCount(1);
  await side().getByRole('button', { name: 'Show every note' }).click();
  await expect(side().getByRole('region', { name: 'Work' })).toBeVisible();
});

test('the Markdown view shows the file as it is kept, and typing there is saved', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n\n- [ ] Call Sam\n');
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text().getByRole('checkbox', { name: 'Task item checkbox for Call Sam' })).not.toBeChecked();
  await notesMenu('Show Markdown');
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
  await expect(side().getByRole('region', { name: 'Pinned' })).toHaveCount(0);
  await side().getByRole('button', { name: 'Pin Motors' }).click();
  const pinned = side().getByRole('region', { name: 'Pinned' });
  await expect(pinned.getByRole('button', { name: 'Motors', exact: true })).toBeVisible();
  await expect(side().getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Motors', exact: true })).toBeVisible();
  await pinned.getByRole('button', { name: 'Unpin Motors' }).click();
  await expect(side().getByRole('region', { name: 'Pinned' })).toHaveCount(0);
});

test('History shows what the page was, compared with now, and Restore puts it back (and Undo undoes that)', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n\nCall Sam.\n');
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await text().getByText('Call Sam.').click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(' Book the sled.');
  await expect(status()).toHaveText('Saved');
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan\n\nCall Sam. Book the sled.\n');
  await notesMenu('Version history…');
  const history = shell().getByRole('region', { name: 'History' });
  await expect(history.getByRole('navigation', { name: 'Versions' }).getByRole('button')).toHaveCount(1);
  await expect(history.getByRole('list', { name: 'What restoring changes' })).toContainText('Call Sam.');
  await history.getByRole('button', { name: 'Whole page' }).click();
  await expect(history.getByLabel('That version')).toHaveText('# Plan\n\nCall Sam.\n');
  await history.getByRole('button', { name: 'Restore this version' }).click();
  await expect(history).toHaveCount(0);
  await expect.poll(() => onDisk('Work', 'Plan.md')).toBe('# Plan\n\nCall Sam.\n');
  await shell().getByRole('status').filter({ hasText: 'Restored the version from' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => onDisk('Work', 'Plan.md')).toBe('# Plan\n\nCall Sam. Book the sled.\n');
});

// A four-pixel PNG.
const DOT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAgMAAADUn3btAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURX+z5m+PTv///yURNH0AAAABYktHRAJmC3xkAAAAB3RJTUUH6gsICzIQNf0gTgAAABBJREFUCNdjYGBgYAhlCAUAAVwAq6n8OZAAAAAASUVORK5CYII=', 'base64');

test('a picture added to a page is kept beside it, linked in its Markdown, and shown in the page', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Battery.md'), '# Battery\n\nThe cell:\n');
  fs.writeFileSync(file('Work', 'Missing.md'), '# Missing\n\n![gone](Missing%20files/gone.png)\n');
  await start();
  await side().getByRole('button', { name: 'Battery', exact: true }).click();
  await text().getByText('The cell:').click();
  await shell().keyboard.press('End');
  await shell().getByLabel('Choose files to add').setInputFiles({ name: 'cell photo.png', mimeType: 'image/png', buffer: DOT });
  await expect.poll(() => onDisk('Work', 'Battery.md')).toBe('# Battery\n\nThe cell:\n\n![cell photo.png](Battery%20files/cell%20photo.png)\n');
  expect(fs.readFileSync(file('Work', 'Battery files', 'cell photo.png'))).toEqual(DOT);
  await expect(text().locator('img')).toHaveJSProperty('naturalWidth', 4);
  // A page whose picture is not there says so, rather than showing a broken image.
  await side().getByRole('button', { name: 'Missing', exact: true }).click();
  await expect(text().locator('figure[data-missing="true"]')).toBeVisible();
  // Deleting the page takes its files with it (into the Trash).
  await side().getByRole('button', { name: 'Battery', exact: true }).click();
  await side().getByRole('button', { name: 'Battery', exact: true }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Battery' }).getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(file('Work', 'Battery files'))).toBe(false);
});

test('a notebook is renamed and a note moved with links following them, and a deleted note comes back from the Trash', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n\nShopping: [the list](../Home/Groceries.md)\n');
  fs.writeFileSync(file('Home', 'Groceries.md'), '# Groceries\n\n- [ ] Oats\n');
  await start();
  // Rename, from the notebook's own menu: the name is typed in place, and the link to its page follows it.
  await side().getByRole('button', { name: 'Notebook options for Home' }).click();
  await shell().getByRole('menu', { name: 'Home' }).getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await side().getByRole('textbox', { name: 'New name for Home' }).fill('Kitchen');
  await side().getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(side().getByRole('region', { name: 'Kitchen' })).toBeVisible();
  await expect.poll(() => fs.existsSync(file('Kitchen', 'Groceries.md'))).toBe(true);
  expect(fs.existsSync(file('Home'))).toBe(false);
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan\n\nShopping: [the list](../Kitchen/Groceries.md)\n');
  // Move to another notebook, from the note's menu: the open note stays open where it now is.
  await side().getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(text().locator('h1')).toHaveText('Groceries');
  await side().getByRole('button', { name: 'Groceries', exact: true }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Groceries' }).getByRole('menuitem', { name: 'Move to Work' }).click();
  await expect.poll(() => fs.existsSync(file('Work', 'Groceries.md'))).toBe(true);
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan\n\nShopping: [the list](Groceries.md)\n');
  await expect(side().getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Groceries', exact: true })).toBeVisible();
  await expect(text().locator('h1')).toHaveText('Groceries');
  // Delete goes to the Trash, and Put back brings the note back where it was, open.
  await side().getByRole('button', { name: 'Groceries', exact: true }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Groceries' }).getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(file('Work', 'Groceries.md'))).toBe(false);
  await expect(shell().getByRole('region', { name: 'No note open' })).toBeVisible();
  await expect(shell().getByRole('status').filter({ hasText: 'Moved “Groceries” to the Trash' })).toBeVisible();
  const trash = side().getByRole('region', { name: 'Trash' });
  await trash.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(trash.getByRole('button', { name: 'Trash', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(trash.getByRole('button', { name: 'Groceries', exact: true })).toHaveAccessibleDescription(/^From Work · \d+ days left$/);
  await trash.getByRole('button', { name: 'Groceries', exact: true }).click();
  await shell().getByRole('menu', { name: 'Groceries' }).getByRole('menuitem', { name: 'Put back' }).click();
  await expect.poll(() => fs.existsSync(file('Work', 'Groceries.md'))).toBe(true);
  expect(onDisk('Work', 'Groceries.md')).toBe('# Groceries\n\n- [ ] Oats\n');
  await expect(text().locator('h1')).toHaveText('Groceries');
  await expect(trash).toHaveCount(0);
  // A whole notebook goes to the Trash too, and Empty Trash ends it for good.
  await side().getByRole('button', { name: 'Notebook options for Kitchen' }).click();
  await shell().getByRole('menu', { name: 'Kitchen' }).getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(side().getByRole('region', { name: 'Kitchen' })).toHaveCount(0);
  // The Undo pill brings it straight back; then it goes again.
  await shell().getByRole('status').filter({ hasText: 'Moved “Kitchen” to the Trash' }).getByRole('button', { name: 'Undo' }).click();
  await expect(side().getByRole('region', { name: 'Kitchen' })).toBeVisible();
  await side().getByRole('button', { name: 'Notebook options for Kitchen' }).click();
  await shell().getByRole('menu', { name: 'Kitchen' }).getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(side().getByRole('region', { name: 'Kitchen' })).toHaveCount(0);
  await side().getByRole('region', { name: 'Trash' }).getByRole('button', { name: 'Empty Trash' }).click();
  await side().getByRole('button', { name: 'Confirm empty Trash' }).click();
  await expect(side().getByRole('region', { name: 'Trash' })).toHaveCount(0);
  expect(fs.existsSync(file('.deleted'))).toBe(false);
});

test('Ctrl+O opens the launcher narrowed to Notes: recent notes, a note by its title, and New note when none has it', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Work', 'Launch brief.md'), '# Launch brief\n\nShip on Friday.\n');
  fs.writeFileSync(file('Home', 'Groceries.md'), '# Groceries\n\n- [ ] Oats\n');
  await start();
  await shell().keyboard.press('Control+o');
  const box = shell().getByRole('combobox', { name: 'Search in Notes' });
  await expect(box).toBeFocused();
  const results = shell().getByRole('listbox', { name: 'Results' });
  // With nothing typed, the notes edited last.
  await expect(results.getByRole('option', { name: /Launch brief/ })).toBeVisible();
  await expect(results.getByRole('option', { name: /Groceries/ })).toBeVisible();
  await box.fill('launch');
  await expect(results.getByRole('option', { name: /Launch brief/ }).first()).toBeVisible();
  await shell().keyboard.press('Enter');
  await expect(text().locator('h1')).toHaveText('Launch brief');
  // A title no note has: the first row makes it, in the notebook that is open.
  await shell().keyboard.press('Control+o');
  await box.fill('Standup');
  await expect(results.getByRole('option').first()).toHaveAccessibleName(/New note “Standup”/);
  await shell().keyboard.press('Enter');
  await expect.poll(() => fs.existsSync(file('Work', 'Standup.md'))).toBe(true);
  await expect(text().locator('h1')).toHaveText('Standup');
  // Backspace in the empty box widens it to everything again.
  await shell().keyboard.press('Control+o');
  await shell().keyboard.press('Backspace');
  await expect(shell().getByRole('combobox', { name: 'Find apps, pages and commands' })).toBeVisible();
  await shell().keyboard.press('Escape');
});

test('[[ links another note, the link opens it, and that note lists where it is linked from', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n\nShopping:\n');
  fs.writeFileSync(file('Home', 'Groceries.md'), '# Groceries\n\n- [ ] Oats\n');
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await text().getByText('Shopping:').click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(' [[gro');
  await expect(shell().getByRole('listbox', { name: 'Notes to link' }).getByRole('option')).toHaveText([/Groceries/]);
  await shell().keyboard.press('Enter');
  await expect.poll(() => onDisk('Work', 'Plan.md')).toBe('# Plan\n\nShopping: [Groceries](../Home/Groceries.md)\n');
  await text().getByRole('link', { name: 'Groceries' }).click();
  await expect(text().locator('h1')).toHaveText('Groceries');
  // Linked from is one quiet line at the end of the page, opened to list the notes.
  const linked = shell().getByRole('region', { name: 'Linked from' });
  await linked.getByRole('button', { name: 'Linked from 1' }).click();
  await linked.getByRole('button', { name: /Plan/ }).click();
  await expect(text().locator('h1')).toHaveText('Plan');
});

test('a comment on chosen words is kept beside the page, marks the words, and can be resolved', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n\nThe price hold lasts until Friday.\n');
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await text().getByText('The price hold lasts until Friday.').dblclick({ position: { x: 5, y: 8 } });
  await shell().getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: 'Comment' }).click();
  const composer = shell().getByRole('dialog', { name: 'New comment' });
  await composer.getByRole('textbox', { name: 'Comment' }).fill('Is that firm?');
  await composer.getByRole('button', { name: 'Comment' }).click();
  const comments = shell().getByRole('region', { name: 'Comments' });
  await expect(comments.getByRole('listitem')).toHaveCount(1);
  await expect(comments).toContainText('Is that firm?');
  await expect(text().locator('.note-commented')).toHaveCount(1);
  // Kept beside the page; the page itself is only what was written.
  const kept = path.join(userData, 'workspace', 'notes', '.comments', 'Work', 'Plan.json');
  await expect.poll(() => fs.existsSync(kept) && JSON.parse(fs.readFileSync(kept, 'utf8'))[0]?.text).toBe('Is that firm?');
  expect(onDisk('Work', 'Plan.md')).toBe('# Plan\n\nThe price hold lasts until Friday.\n');
  await comments.getByRole('button', { name: 'Resolve' }).click();
  await expect(text().locator('.note-commented')).toHaveCount(0);
  await expect(comments.getByRole('button', { name: 'Show 1 resolved' })).toBeVisible();
  await expect.poll(() => JSON.parse(fs.readFileSync(kept, 'utf8'))[0]?.resolved).toBe(true);
});

test('Share exports the page as Markdown, with its pictures, and as one web page', async () => {
  fs.mkdirSync(file('Work', 'Battery files'), { recursive: true });
  fs.writeFileSync(file('Work', 'Battery files', 'cell.png'), DOT);
  fs.writeFileSync(file('Work', 'Battery.md'), '# Battery\n\n![cell](Battery%20files/cell.png)\n');
  await start();
  await side().getByRole('button', { name: 'Battery', exact: true }).click();
  await expect(text().locator('img')).toHaveJSProperty('naturalWidth', 4);
  const exports = path.join(userData, 'workspace', 'Exports');
  await format().getByRole('button', { name: 'Share' }).click();
  await shell().getByRole('menuitem', { name: 'Export as Markdown' }).click();
  await expect(shell().getByRole('status').filter({ hasText: 'Saved to Exports/Battery.md' })).toBeVisible();
  expect(fs.readFileSync(path.join(exports, 'Battery.md'), 'utf8')).toBe('# Battery\n\n![cell](Battery%20files/cell.png)\n');
  expect(fs.readFileSync(path.join(exports, 'Battery files', 'cell.png'))).toEqual(DOT);
  await format().getByRole('button', { name: 'Share' }).click();
  await shell().getByRole('menuitem', { name: 'Export as web page' }).click();
  await expect.poll(() => fs.existsSync(path.join(exports, 'Battery.html'))).toBe(true);
  const html = fs.readFileSync(path.join(exports, 'Battery.html'), 'utf8');
  expect(html).toContain('<title>Battery</title>');
  expect(html).toContain('src="data:image/png;base64,');
});

test("Today's note makes a dated page in Journal once, and opens that same page after", async () => {
  await start();
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await notesMenu('Today’s note');
  await expect(text().locator('h1')).toHaveText(day);
  await expect.poll(() => (fs.existsSync(file('Journal')) ? fs.readdirSync(file('Journal')).filter((f) => f.endsWith('.md')) : [])).toEqual([`${day}.md`]);
  await text().locator('h1').click();
  await shell().keyboard.press('End');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('Called Veltro.');
  await expect.poll(() => onDisk('Journal', `${day}.md`)).toContain('Called Veltro.');
  // From anywhere, Ctrl+K "Today's note" opens the same page rather than making another.
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Today’s note');
  await shell().getByRole('option', { name: /Today’s note/ }).first().click();
  await expect(text()).toContainText('Called Veltro.');
  expect(fs.readdirSync(file('Journal')).filter((f) => f.endsWith('.md'))).toEqual([`${day}.md`]);
});

test('a notebook lists its notes by last edit, by when they were made, or by title, pinned ones first', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  for (const [name, edited] of [['Beta', 3], ['Alpha', 1], ['Gamma', 2]] as const) {
    fs.writeFileSync(file('Work', `${name}.md`), `# ${name}\n`);
    const at = new Date(Date.UTC(2026, 10, edited));
    fs.utimesSync(file('Work', `${name}.md`), at, at);
  }
  // When each was made, as Notes keeps it: Gamma first, Beta last.
  fs.writeFileSync(file('.created.json'), JSON.stringify({ 'Work/Gamma.md': Date.UTC(2026, 9, 1), 'Work/Alpha.md': Date.UTC(2026, 9, 2), 'Work/Beta.md': Date.UTC(2026, 9, 3) }));
  await start();
  const work = side().getByRole('region', { name: 'Work' });
  const order = () => work.locator('button.list-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
  await expect.poll(order).toEqual(['Beta', 'Gamma', 'Alpha']);
  await viewMenu('Sort notes by title');
  await expect.poll(order).toEqual(['Alpha', 'Beta', 'Gamma']);
  await viewMenu('Sort notes by date created');
  await expect.poll(order).toEqual(['Beta', 'Alpha', 'Gamma']);
  await work.getByRole('button', { name: 'Pin Gamma' }).click();
  await expect.poll(order).toEqual(['Gamma', 'Beta', 'Alpha']);
  // The choice is kept for the next visit.
  expect(await shell().evaluate(() => window.localStorage.getItem('mobius.notes.sort'))).toBe('created');
});
