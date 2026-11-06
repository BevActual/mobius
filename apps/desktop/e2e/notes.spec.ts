import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched } from './harness';
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
  fs.rmSync(userData, { recursive: true, force: true });
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
const text = (): Locator => shell().getByRole('textbox', { name: 'Page text' });
const status = (): Locator => shell().locator('.note-status');
const file = (...parts: string[]) => path.join(userData, 'workspace', 'notes', ...parts);
const newNotebook = async (name: string) => {
  await side().getByRole('button', { name: 'New notebook' }).first().click();
  await side().getByRole('textbox', { name: 'Notebook name' }).fill(name);
  await side().getByRole('button', { name: 'Create' }).click();
};

test('a first notebook and page are real files, and typing is saved', async () => {
  await start();
  await expect(side().getByText('Pages are kept as Markdown files')).toBeVisible();
  await newNotebook('Work');
  await expect(text()).toBeFocused();
  await expect(text()).toHaveValue('# Untitled\n\n');
  await text().fill('# Launch plan\n\nShip Notes this week.');
  await expect(status()).toHaveText('Saved');
  expect(fs.readFileSync(file('Work', 'Untitled.md'), 'utf8')).toBe('# Launch plan\n\nShip Notes this week.');
  // The list and the top strip take the title from the first heading.
  await expect(side().getByRole('button', { name: 'Launch plan', exact: true })).toBeVisible();
  await expect(shell().locator('.strip-title')).toHaveText('Launch plan');
});

test('pages survive a restart, search finds them, and a deleted page is gone from disk', async () => {
  fs.mkdirSync(file('Home'), { recursive: true });
  fs.writeFileSync(file('Home', 'Groceries.md'), '# Groceries\n- oat milk\n');
  fs.writeFileSync(file('Home', 'Garden.md'), '# Garden\n- tomatoes\n');
  await start();
  await side().getByRole('button', { name: 'Garden', exact: true }).click();
  await expect(text()).toHaveValue('# Garden\n- tomatoes\n');
  await side().getByRole('searchbox', { name: 'Search notes' }).fill('oat');
  const results = side().getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Groceries/ }).click();
  await expect(text()).toHaveValue('# Groceries\n- oat milk\n');
  await side().getByRole('searchbox', { name: 'Search notes' }).fill('');
  await side().getByRole('button', { name: 'Delete Groceries' }).click();
  await side().getByRole('button', { name: 'Confirm delete Groceries' }).click();
  await expect(side().getByRole('button', { name: 'Groceries', exact: true })).toHaveCount(0);
  expect(fs.existsSync(file('Home', 'Groceries.md'))).toBe(false);
  await expect(shell().getByText('Choose a page, or make a new one.')).toBeVisible();
});

test('the agent panel sits beside a note, and a change the agent makes shows up in the open page', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n- one\n');
  await start([callsTool('files-edit', { path: 'notes/Work/Plan.md', old: '- one', new: '- one\n- two' }), says(['Added it.'])]);
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text()).toHaveValue('# Plan\n- one\n');
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeVisible();
  await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'off' }));
  await shell().getByRole('textbox', { name: 'Message Mobius' }).fill('add two');
  await shell().getByRole('textbox', { name: 'Message Mobius' }).press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant').last()).toHaveText('Added it.');
  await expect(text()).toHaveValue('# Plan\n- one\n- two\n');
});

test('if the agent changes the page while the person is typing, nothing is lost and the person chooses', async () => {
  fs.mkdirSync(file('Work'), { recursive: true });
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\n');
  await start();
  await side().getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(text()).toHaveValue('# Plan\n');
  // The window has not saved yet when the change lands: simulate by holding the save back.
  await shell().evaluate(() => {
    const notes = window.mobius.notes!;
    const real = notes.save;
    (window as unknown as { releaseSave: () => void }).releaseSave = () => { notes.save = real; };
    notes.save = () => new Promise(() => {});
  });
  await text().press('Control+Home');
  await text().press('End');
  await text().pressSequentially(' mine');
  fs.writeFileSync(file('Work', 'Plan.md'), '# Plan\nfrom the agent\n');
  await mobius!.shell.evaluate(() => (window as unknown as { releaseSave: () => void }).releaseSave());
  // The disk change comes from outside Mobius here, so ask the editor to save; the stale save is refused.
  await text().pressSequentially('!');
  await expect(shell().getByRole('alert')).toContainText('changed this page');
  await expect(text()).toHaveValue('# Plan mine!\n');
  expect(fs.readFileSync(file('Work', 'Plan.md'), 'utf8')).toBe('# Plan\nfrom the agent\n');
  await shell().getByRole('button', { name: 'Keep mine' }).click();
  await expect(status()).toHaveText('Saved');
  expect(fs.readFileSync(file('Work', 'Plan.md'), 'utf8')).toBe('# Plan mine!\n');
});
