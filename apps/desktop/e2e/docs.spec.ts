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
  await shell().getByRole('complementary', { name: 'Docs sidebar' }).getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page()).toBeVisible();
  await expect.poll(() => fs.existsSync(file('Documents/Untitled.md'))).toBe(true);
  await page().click();
  await shell().keyboard.press('Control+End');
  // Styles are in the Aa panel, as in Notes; it stays open while formatting and the keys still go to the page.
  // The format bar is the window's toolbar, on the frame.
  await shell().getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: 'Format text' }).click();
  await shell().getByRole('dialog', { name: 'Text format' }).getByRole('button', { name: 'Heading', exact: true }).click();
  await shell().keyboard.type('Plan');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('Book the ');
  await shell().keyboard.press('Control+b');
  await shell().keyboard.type('terrace');
  await shell().keyboard.press('Control+b');
  await shell().keyboard.type(' early.');
  await expect.poll(() => fs.readFileSync(file('Documents/Untitled.md'), 'utf8'), { timeout: 5000 }).toContain('## Plan\n\nBook the **terrace** early.');
  // The outline lists the headings (it folds away when the page is narrow, as it is beside the agent panel here).
  await expect(editor().locator('.doc-outline-item', { hasText: 'Plan' })).toHaveCount(1);
  await expect(editor().getByText(/\d+ words/)).toBeVisible();
});

test('a writing tool asks Mobius, and its changes are marked in the page, each kept or discarded on its own', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  await start([
    callsTool('files-edit', { path: 'docs/Work/Offsite brief.md', old: 'We have been talking for quite a while now about getting the whole team out of the office together for a few days.', new: 'We need a few days away, together, to plan next year.' }),
    callsTool('files-edit', { path: 'docs/Work/Offsite brief.md', old: '- Plan on the 13th', new: '- Plan on the terrace on the 13th' }),
    says(['Made it shorter.']),
  ]);
  await shell().getByRole('complementary', { name: 'Docs sidebar' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');
  // What Mobius will see is said on the button: the whole document, since nothing is selected.
  await expect(shell().getByRole('button', { name: 'Writing tools' })).toHaveAttribute('title', /It sees the whole document/);
  await shell().getByRole('button', { name: 'Writing tools' }).click();
  const menu = shell().getByRole('menu', { name: 'Writing tools' });
  await menu.getByRole('menuitem', { name: 'Make it shorter' }).click();

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

test('a comment on chosen words, a link to another document, and Share all work in a document', async () => {
  fs.mkdirSync(path.dirname(file('Work/Offsite brief.md')), { recursive: true });
  fs.writeFileSync(file('Work/Offsite brief.md'), BRIEF);
  fs.writeFileSync(file('Work/Venues.md'), '# Venues\n\nThe lodge, or the farm.\n');
  await start();
  await shell().getByRole('complementary', { name: 'Docs sidebar' }).getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Offsite brief', exact: true }).click();
  await expect(page()).toContainText('We have been talking');

  // A comment: kept beside the document, its words marked in the page.
  await page().getByText('Arrive on the 12th').dblclick({ position: { x: 5, y: 8 } });
  await shell().getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: 'Comment' }).click();
  const composer = shell().getByRole('dialog', { name: 'New comment' });
  await composer.getByRole('textbox', { name: 'Comment' }).fill('Or the 11th?');
  await composer.getByRole('button', { name: 'Comment' }).click();
  await expect(shell().getByRole('region', { name: 'Comments' })).toContainText('Or the 11th?');
  await expect(page().locator('.note-commented')).toHaveCount(1);
  const kept = path.join(userData, 'workspace', 'docs', '.comments', 'Work', 'Offsite brief.json');
  await expect.poll(() => fs.existsSync(kept) && JSON.parse(fs.readFileSync(kept, 'utf8'))[0]?.text).toBe('Or the 11th?');

  // A link to another document, chosen by its name; it is kept as a plain Markdown link and opens that document.
  await page().getByText('Plan on the 13th').click();
  await shell().keyboard.press('End');
  await shell().keyboard.type(', see ');
  await shell().getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: 'Link' }).click();
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
