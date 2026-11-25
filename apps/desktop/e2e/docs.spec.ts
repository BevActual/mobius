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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-docs-'));
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
const editor = (): Locator => shell().locator('.doc-editor');
const page = (): Locator => editor().getByRole('textbox', { name: 'Document text' });
const file = (p: string) => path.join(userData, 'workspace', 'docs', p);
const BRIEF = '# Offsite brief\n\n## Why we are going\n\nWe have been talking for quite a while now about getting the whole team out of the office together for a few days.\n\n## Agenda\n\n- Arrive on the 12th\n- Plan on the 13th\n';

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Docs');
  await shell().keyboard.press('Enter');
  await expect(editor()).toBeVisible();
}

test('a new document is written on the page with formatting and kept as Markdown, with its outline beside it', async () => {
  await start();
  await shell().getByRole('complementary', { name: 'Documents' }).getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page()).toBeVisible();
  await expect.poll(() => fs.existsSync(file('Documents/Untitled.md'))).toBe(true);
  await page().click();
  await shell().keyboard.press('Control+End');
  // The paragraph's style is the first thing in the window's toolbar ("Body ⌄"); the keys still go to the page after.
  await shell().getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: /^Paragraph style/ }).click();
  await shell().getByRole('menu', { name: 'Paragraph style' }).getByRole('menuitemcheckbox', { name: /^Heading\b/ }).click();
  // The choice applies once the menu has closed, and the keys go back to the page then.
  await expect(shell().getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: 'Paragraph style: Heading' })).toBeVisible();
  await expect(shell().getByRole('menu', { name: 'Paragraph style' })).toHaveCount(0);
  await shell().keyboard.type('Plan');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('Book the ');
  await shell().keyboard.press('Control+b');
  await shell().keyboard.type('terrace');
  await shell().keyboard.press('Control+b');
  await shell().keyboard.type(' early.');
  await expect.poll(() => fs.readFileSync(file('Documents/Untitled.md'), 'utf8'), { timeout: 5000 }).toContain('## Plan\n\nBook the **terrace** early.');
  // The outline is the right dock's Outline panel (from the window's ⋯), never a column beside the page; it lists the
  // headings (not the Documents list), and the line under the title counts its words.
  await expect(editor().getByRole('navigation', { name: 'Outline' })).toHaveCount(0);
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'Docs', exact: true }).click();
  await shell().getByRole('menu', { name: 'Docs' }).getByRole('menuitem', { name: 'Show the outline' }).click();
  await expect(shell().getByRole('complementary', { name: 'Inspector' }).getByRole('navigation', { name: 'Outline' }).getByRole('button', { name: 'Plan', exact: true })).toHaveCount(1);
  await expect(shell().getByRole('complementary', { name: 'Documents' }).getByRole('button', { name: 'Plan', exact: true })).toHaveCount(0);
  await expect(page().locator('.doc-meta')).toContainText(/\d+ words/);
  await expect(editor().locator('.doc-status')).toHaveCount(0);
});

test('a document starts from a template in the Templates folder, and any document can be saved as one', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  fs.mkdirSync(path.dirname(file('Templates/Weekly update.md')), { recursive: true });
  fs.writeFileSync(file('Templates/Weekly update.md'), '# Weekly update, {{date}}\n\n## Done\n\n## Next\n');
  await start();
  const docsMenu = async (item: string) => {
    await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'Docs', exact: true }).click();
    await shell().getByRole('menu', { name: 'Docs' }).getByRole('menuitem', { name: item }).click();
  };
  await docsMenu('New from Weekly update');
  // Says what went wrong, if anything did.
  await expect(page()).toContainText(String(new Date().getFullYear()));
  await expect(shell().locator('.toast')).toHaveCount(0);
  // A copy, in a folder other than Templates (whichever was open, else the first), named with the date filled in.
  const all = () => fs.readdirSync(file(''), { recursive: true }).map(String).map((p) => p.replace(/\\/g, '/')).filter((p) => p.endsWith('.md'));
  const copy = () => all().find((p) => /^Work\/Weekly update, .+\.md$/.test(p));
  await expect.poll(copy).toBeTruthy();
  expect(copy()).not.toContain('{{');
  const made = fs.readFileSync(file(copy()!), 'utf8');
  expect(made).toContain('## Done\n\n## Next');
  expect(made).not.toContain('{{date}}');
  expect(made).toContain(String(new Date().getFullYear()));
  // The template itself is untouched.
  expect(fs.readFileSync(file('Templates/Weekly update.md'), 'utf8')).toContain('{{date}}');

  await docsMenu('Save as template');
  await expect.poll(() => fs.readdirSync(file('Templates')).filter((n) => n.endsWith('.md')).length).toBe(2);
});

test('Ctrl+F finds in the page and Ctrl+H replaces one or all, kept in the file and undone in one step', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  await start();
  await shell().getByRole('complementary', { name: 'Documents' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');
  await page().click();
  await shell().keyboard.press('Control+f');
  const bar = editor().getByRole('search', { name: 'Find in page' });
  await bar.getByRole('textbox', { name: 'Find in page' }).fill('the');
  await expect(bar.getByRole('status')).toHaveText(/of 5$/);
  await expect(editor().locator('.find-hit')).toHaveCount(5);
  await bar.getByRole('button', { name: 'Match case' }).click();
  await bar.getByRole('textbox', { name: 'Find in page' }).fill('ferry');
  await expect(bar.getByRole('status')).toHaveText('No matches');
  // Ctrl+H adds the Replace line to the same bar.
  await shell().keyboard.press('Control+h');
  const both = editor().getByRole('search', { name: 'Find and replace' });
  await both.getByRole('textbox', { name: 'Find in page' }).fill('13th');
  await both.getByRole('textbox', { name: 'Replace with' }).fill('14th');
  await both.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page()).toContainText('Plan on the 14th');
  await both.getByRole('textbox', { name: 'Find in page' }).fill('the ');
  await both.getByRole('textbox', { name: 'Replace with' }).fill('our ');
  await both.getByRole('button', { name: 'Replace all' }).click();
  await expect(both.getByRole('status')).toHaveText('Replaced 4');
  await expect.poll(() => fs.readFileSync(file('Work/Offsite brief.md'), 'utf8')).toContain('Arrive on our 12th');
  // Esc closes the bar and clears the highlights; one Undo puts every replacement back.
  await both.getByRole('textbox', { name: 'Replace with' }).press('Escape');
  await expect(editor().getByRole('search')).toHaveCount(0);
  await expect(editor().locator('.find-hit')).toHaveCount(0);
  await shell().keyboard.press('Control+z');
  await expect(page()).toContainText('Arrive on the 12th');
  await expect(page()).toContainText('Plan on the 14th');
});

test('a writing tool asks Mobius, and its changes are marked in the page, each kept or discarded on its own', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  await start([
    callsTool('files-edit', { path: 'docs/Work/Offsite brief.md', old: 'We have been talking for quite a while now about getting the whole team out of the office together for a few days.', new: 'We need a few days away, together, to plan next year.' }),
    callsTool('files-edit', { path: 'docs/Work/Offsite brief.md', old: '- Plan on the 13th', new: '- Plan on the terrace on the 13th' }),
    says(['Made it shorter.']),
  ]);
  await shell().getByRole('complementary', { name: 'Documents' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');
  // Mobius's writing tools are at the top of the window's one ⋯, on the whole document when nothing is chosen.
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'Docs', exact: true }).click();
  await shell().getByRole('menu', { name: 'Docs' }).getByRole('menuitem', { name: 'Make it shorter' }).click();
  // The Mobius panel is just Mobius: the document's Outline waits, hidden, in the inspector, never as a tab beside it.
  await expect(shell().getByRole('tab', { name: 'Mobius' })).toHaveCount(0);
  await expect(shell().getByRole('complementary', { name: 'Inspector' })).toBeHidden();

  const log = shell().getByRole('log', { name: 'Conversation' });
  for (let i = 0; i < 2; i++) await log.getByRole('button', { name: 'Allow once' }).first().click();
  await expect(log.locator('.msg.assistant')).toHaveText('Made it shorter.');
  expect(JSON.stringify(model!.requests[0])).toContain('docs/Work/Offsite brief.md');

  // Each change is one dashed block where it is: the words taken out struck through at its top, what was added under
  // them, and the change's own Discard and Keep below it. No bar above the page while the changes show.
  const notes = page().locator('.doc-change');
  await expect(notes).toHaveCount(2);
  await expect(page().locator('.doc-change-old').first()).toContainText('We have been talking');
  await expect(editor().locator('.doc-review')).toHaveCount(0);
  await expect(page().locator('.doc-change-new').first()).toContainText('We need a few days away');
  await notes.nth(1).getByRole('button', { name: 'Discard this change' }).click();
  await expect.poll(() => fs.readFileSync(file('Work/Offsite brief.md'), 'utf8')).toContain('- Plan on the 13th');
  expect(fs.readFileSync(file('Work/Offsite brief.md'), 'utf8')).toContain('We need a few days away');
  await expect(notes).toHaveCount(1);
  // Keeping the last change keeps the turn: the marks and the bar above the page go.
  await notes.first().getByRole('button', { name: 'Keep this change' }).click();
  await expect(notes).toHaveCount(0);
  await expect(page().locator('.doc-change-new')).toHaveCount(0);
  await expect(editor().locator('.doc-review')).toHaveCount(0);
  await expect(page()).toContainText('We need a few days away, together, to plan next year.');
});

test('a change Mobius makes to the open document is marked as it lands, and its Keep comes when the turn ends', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  // The answer comes slowly, so the turn is still running when the document has changed.
  await start([callsTool('files-edit', { path: 'docs/Work/Offsite brief.md', old: '- Plan on the 13th', new: '- Plan on the terrace on the 13th' }), says(['Moved ', 'it.'], 3000)]);
  await shell().getByRole('complementary', { name: 'Documents' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');
  await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'off' }));
  await shell().getByRole('textbox', { name: 'Message Mobius' }).fill('plan on the terrace');
  await shell().getByRole('textbox', { name: 'Message Mobius' }).press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  const notes = page().locator('.doc-change');
  await expect(notes).toHaveCount(1);
  await expect(page().locator('.doc-change-new')).toContainText('terrace');
  await expect(log.locator('.msg.assistant').last()).not.toHaveText('Moved it.');
  await expect(notes.getByRole('button', { name: 'Keep this change' })).toHaveCount(0);
  await expect(log.locator('.msg.assistant').last()).toHaveText('Moved it.', { timeout: 15_000 });
  await expect(page().locator('.doc-change').getByRole('button', { name: 'Keep this change' })).toBeVisible();
});

test('a comment on chosen words, a link to another document, and Share all work in a document', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  fs.writeFileSync(file('Work/Venues.md'), '# Venues\n\nThe lodge, or the farm.\n');
  await start();
  await shell().getByRole('complementary', { name: 'Documents' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');

  // A comment: kept beside the document, its words marked in the page.
  await page().getByText('Arrive on the 12th').dblclick({ position: { x: 5, y: 8 } });
  await shell().getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: 'Comment' }).click();
  const composer = shell().getByRole('dialog', { name: 'New comment' });
  await composer.getByRole('textbox', { name: 'Comment' }).fill('Or the 11th?');
  await composer.getByRole('button', { name: 'Comment' }).click();
  // Comments are the inspector's Comments panel, beside the outline; commenting brings it forward.
  await expect(shell().getByRole('complementary', { name: 'Inspector' }).getByRole('region', { name: 'Comments' })).toContainText('Or the 11th?');
  await expect(page().locator('.note-commented')).toHaveCount(1);
  const kept = path.join(userData, 'workspace', 'docs', '.comments', 'Work', 'Offsite brief.json');
  await expect.poll(() => fs.existsSync(kept) && JSON.parse(fs.readFileSync(kept, 'utf8'))[0]?.text).toBe('Or the 11th?');

  // A link to another document, chosen by its name; it is kept as a plain Markdown link and opens that document.
  await page().getByText('Plan on the 13th').click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(', see ');
  // Link is in the toolbar when there is room, and in the window's ⋯ always (the test window is narrow beside Mobius).
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'Docs', exact: true }).click();
  await shell().getByRole('menu', { name: 'Docs' }).getByRole('menuitem', { name: 'Add a link…' }).click();
  await shell().getByRole('combobox', { name: 'Link to' }).fill('venu');
  await expect(shell().getByRole('option', { name: /Venues/ })).toBeVisible();
  await shell().keyboard.press('Enter');
  await expect.poll(() => fs.readFileSync(file('Work/Offsite brief.md'), 'utf8'), { timeout: 5000 }).toContain('- Plan on the 13th, see [Venues](Venues.md)');

  // Share: a copy saved in Exports.
  await shell().getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: 'Share' }).click();
  await shell().getByRole('menuitem', { name: 'Export as Markdown' }).click();
  await expect(shell().getByRole('status').filter({ hasText: 'Saved to Exports/Offsite brief.md' })).toBeVisible();
  expect(fs.readFileSync(path.join(userData, 'workspace', 'Exports', 'Offsite brief.md'), 'utf8')).toContain('[Venues](Venues.md)');

  await page().getByRole('link', { name: 'Venues' }).click();
  await expect(page()).toContainText('The lodge, or the farm.');
});

test('Review this in the Mobius panel switches to Review mode and sends the document in it', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  await start([says(['Two notes on the agenda.'])]);
  await shell().getByRole('complementary', { name: 'Documents' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');
  await shell().getByRole('button', { name: 'Review this' }).click();
  await expect(shell().getByRole('button', { name: /^Mode: / })).toContainText('Review');
  await expect.poll(() => model!.requests.length).toBeGreaterThan(0);
  expect(JSON.stringify(model!.requests.at(-1))).toContain('Review mode.');
  // Review comments and suggests; the file is as it was.
  expect(fs.readFileSync(file('Work/Offsite brief.md'), 'utf8')).toBe(BRIEF);
});

test('a document moves to another folder, goes to the Trash with Undo and comes back, and a folder is renamed', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  fs.mkdirSync(path.dirname(file('Home/Venues.md')), { recursive: true });
  fs.writeFileSync(file('Home/Venues.md'), '# Venues\n\nThe lodge, or the farm.\n');
  await start();
  const side = () => shell().getByRole('complementary', { name: 'Documents' });
  // A folder is renamed from its own ⋯, typed in place.
  await side().getByRole('button', { name: 'Folder options for Home' }).click();
  await shell().getByRole('menu', { name: 'Home' }).getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await side().getByRole('textbox', { name: 'New name for Home' }).fill('Places');
  await side().getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(side().getByRole('region', { name: 'Places' })).toBeVisible();
  await expect.poll(() => fs.existsSync(file('Places/Venues.md'))).toBe(true);
  // A document moves to another folder from its menu.
  await side().getByRole('button', { name: 'Venues', exact: true }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Venues' }).getByRole('menuitem', { name: 'Move to Work' }).click();
  await expect.poll(() => fs.existsSync(file('Work/Venues.md'))).toBe(true);
  await expect(side().getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Venues', exact: true })).toBeVisible();
  // Move to Trash asks nothing more: the Undo pill says what went and brings it back.
  await side().getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');
  await side().getByRole('button', { name: 'Offsite brief', exact: true }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Offsite brief' }).getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(file('Work/Offsite brief.md'))).toBe(false);
  await shell().getByRole('status').filter({ hasText: 'Moved “Offsite brief” to the Trash' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.existsSync(file('Work/Offsite brief.md'))).toBe(true);
  expect(fs.readFileSync(file('Work/Offsite brief.md'), 'utf8')).toBe(BRIEF);
  // Gone again, it waits in the Trash, where Put back returns it.
  await side().getByRole('button', { name: 'Offsite brief', exact: true }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Offsite brief' }).getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(file('Work/Offsite brief.md'))).toBe(false);
  const trash = side().getByRole('region', { name: 'Trash' });
  await trash.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(trash.getByRole('button', { name: 'Offsite brief', exact: true })).toHaveAccessibleDescription(/^From Work · \d+ days left$/);
  await trash.getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await shell().getByRole('menu', { name: 'Offsite brief' }).getByRole('menuitem', { name: 'Put back' }).click();
  await expect.poll(() => fs.existsSync(file('Work/Offsite brief.md'))).toBe(true);
  await expect(trash).toHaveCount(0);
});

test('Suggesting keeps typing and deleting as suggestions in the file, each accepted or rejected; Viewing only reads', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  await start();
  await shell().getByRole('complementary', { name: 'Documents' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');
  const bar = () => shell().getByRole('toolbar', { name: 'Format' });
  await bar().getByRole('button', { name: 'Document mode: Editing' }).click();
  await shell().getByRole('menu', { name: 'Document mode' }).getByRole('menuitemcheckbox', { name: 'Suggesting' }).click();
  await expect(bar().getByRole('button', { name: 'Document mode: Suggesting' })).toBeVisible();
  // Typed words are an added suggestion, kept in the file as CriticMarkup.
  await page().getByText('Plan on the 13th').click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(' or 14th');
  await expect(page().locator('ins.doc-suggest-add')).toHaveText(/or 14th/);
  await expect.poll(() => fs.readFileSync(file('Work/Offsite brief.md'), 'utf8'), { timeout: 5000 }).toMatch(/Plan on the 13th ?\{\+\+ ?or 14th\+\+\}/);
  // Deleted words stay, struck through.
  await page().getByText('Arrive on the 12th').click();
  await shell().keyboard.press('End');
  for (let i = 0; i < 4; i++) await shell().keyboard.press('Backspace');
  await expect(page().locator('del.doc-suggest-del')).toHaveText('12th');
  await expect.poll(() => fs.readFileSync(file('Work/Offsite brief.md'), 'utf8'), { timeout: 5000 }).toContain('Arrive on the {--12th--}');
  // Rejecting the removal puts the words back as they were.
  await page().locator('del.doc-suggest-del').click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Edit' }).getByRole('menuitem', { name: 'Reject the removal' }).click();
  await expect(page().locator('del.doc-suggest-del')).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Work/Offsite brief.md'), 'utf8'), { timeout: 5000 }).toContain('- Arrive on the 12th\n');
  // Accept all keeps the addition as ordinary text.
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'Docs', exact: true }).click();
  await shell().getByRole('menu', { name: 'Docs' }).getByRole('menuitem', { name: 'Accept all suggestions (1)' }).click();
  await expect(page().locator('ins.doc-suggest-add')).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Work/Offsite brief.md'), 'utf8'), { timeout: 5000 }).toContain('- Plan on the 13th or 14th\n');
  // Viewing: the page only reads, and the writing tools leave the tool row.
  await bar().getByRole('button', { name: 'Document mode: Suggesting' }).click();
  await shell().getByRole('menu', { name: 'Document mode' }).getByRole('menuitemcheckbox', { name: 'Viewing' }).click();
  await expect(page()).toHaveAttribute('contenteditable', 'false');
  await expect(bar().getByRole('button', { name: 'Bold' })).toHaveCount(0);
  await expect(bar().getByRole('button', { name: 'Share' })).toBeVisible();
});
