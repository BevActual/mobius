import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

// The Mobius 2 shell: split view, on-canvas actions in notes, and review and undo of the agent's last turn.
test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Split view, notes and the review strip are built in the Tauri shell');

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-two-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

async function start(replies: ModelReply[] = []): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const workspace = (...parts: string[]) => path.join(userData, 'workspace', ...parts);
const openApp = async (name: string) => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
  await shell().keyboard.press('Enter');
};

test('split view shows two apps, follows the focused pane, swaps and closes', async () => {
  await start();
  await shell().getByRole('button', { name: 'Split view', exact: true }).click();
  const left = shell().getByRole('region', { name: 'Left pane: Browser' });
  const right = shell().getByRole('region', { name: 'Right pane: Notes' });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect(shell().getByRole('separator', { name: 'Resize the panes' })).toHaveAttribute('aria-valuenow', '50');
  // Clicking a pane makes it the one the toolbar and sidebar follow.
  await right.locator('.pane-head').click();
  await expect(shell().locator('.strip-title')).toHaveText('Notes');
  await right.getByRole('button', { name: 'Swap panes' }).click();
  await expect(shell().getByRole('region', { name: 'Left pane: Notes' })).toBeVisible();
  await shell().getByRole('separator', { name: 'Resize the panes' }).focus();
  await shell().keyboard.press('ArrowRight');
  await expect(shell().getByRole('separator', { name: 'Resize the panes' })).toHaveAttribute('aria-valuenow', '55');
  await shell().getByRole('button', { name: 'Close split view' }).click();
  await expect(shell().locator('.pane')).toHaveCount(1);
});

test('text selected in a note becomes a task in one click', async () => {
  fs.mkdirSync(workspace('notes', 'Work'), { recursive: true });
  fs.writeFileSync(workspace('notes', 'Work', 'Plan.md'), '# Plan\n\nCall the printer about the posters.\n');
  fs.mkdirSync(workspace('tasks'), { recursive: true });
  fs.writeFileSync(workspace('tasks', 'Inbox.md'), '# Inbox\n\n- [ ] Existing\n');
  await start();
  await openApp('Notes');
  await shell().getByRole('complementary', { name: 'Notes sidebar' }).getByRole('button', { name: 'Plan', exact: true }).click();
  const text = shell().getByRole('textbox', { name: 'Page text' });
  await expect(text).toHaveValue(/Call the printer/);
  await text.evaluate((field: HTMLTextAreaElement) => {
    const start = field.value.indexOf('Call');
    field.focus();
    field.setSelectionRange(start, field.value.indexOf('.', start));
  });
  await text.press('Shift+ArrowRight');
  const bar = shell().getByRole('toolbar', { name: 'Selected text' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Make a task' }).click();
  await expect(shell().getByRole('status').filter({ hasText: 'Added to Inbox' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(workspace('tasks', 'Inbox.md'), 'utf8')).toContain('- [ ] Call the printer about the posters.');
});

test('what the last turn changed can be reviewed and undone', async () => {
  fs.mkdirSync(workspace('notes', 'Work'), { recursive: true });
  fs.writeFileSync(workspace('notes', 'Work', 'Plan.md'), '# Plan\n');
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.'])]);
  await composer().fill('make an ideas page');
  await composer().press('Enter');
  const card = shell().getByRole('group', { name: /Approval needed/ });
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(true);
  const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
  await expect(strip).toContainText('Changed 1 item');
  await strip.getByRole('button', { name: 'Review' }).click();
  await expect(strip).toContainText('Work / Ideas');
  await strip.getByRole('button', { name: 'Undo all' }).click();
  await expect(shell().getByText('Put back as it was before that turn.')).toBeVisible();
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(false);
  expect(fs.readFileSync(workspace('notes', 'Work', 'Plan.md'), 'utf8')).toBe('# Plan\n');
});
