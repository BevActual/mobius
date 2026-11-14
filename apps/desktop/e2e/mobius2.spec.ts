import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, views, type Fixture, type Launched, removeTestData, turnEnded } from './harness';
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
  removeTestData(userData);
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
  // Split view is in the Window menu, and on Ctrl+\.
  await shell().keyboard.press('Control+\\');
  const left = shell().getByRole('region', { name: 'Left pane: Browser' });
  const right = shell().getByRole('region', { name: 'Right pane: Notes' });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect(shell().getByRole('separator', { name: 'Resize the panes' })).toHaveAttribute('aria-valuenow', '50');
  // Clicking a pane makes it the one the toolbar and sidebar follow.
  // Its name, not the middle of the header, where (by window size) one of the app buttons can sit.
  await right.locator('.pane-name').click();
  await expect(shell().getByRole('complementary', { name: 'Notes sidebar' })).toBeVisible();
  await right.getByRole('button', { name: 'Swap panes' }).click();
  await expect(shell().getByRole('region', { name: 'Left pane: Notes' })).toBeVisible();
  await shell().getByRole('separator', { name: 'Resize the panes' }).focus();
  await shell().keyboard.press('ArrowRight');
  await expect(shell().getByRole('separator', { name: 'Resize the panes' })).toHaveAttribute('aria-valuenow', '55');
  await shell().keyboard.press('Control+\\');
  await expect(shell().locator('.pane')).toHaveCount(1);
});

test('leaving the browser for another app hides the page, and coming back shows it', async () => {
  await start();
  const shown = async () => (await views(mobius!.app)).filter((v) => v.visible).length;
  await expect.poll(shown).toBe(1);
  // The apps are in the rail, always one press away.
  await shell().getByRole('navigation', { name: 'Apps' }).getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(shell().locator('.note-editor')).toBeVisible();
  await expect.poll(shown).toBe(0);
  await shell().getByRole('navigation', { name: 'Apps' }).getByRole('button', { name: 'Browser', exact: true }).click();
  await expect.poll(shown).toBe(1);
});

test('text selected in a note becomes a task in one click', async () => {
  fs.mkdirSync(workspace('notes', 'Work'), { recursive: true });
  fs.writeFileSync(workspace('notes', 'Work', 'Plan.md'), '# Plan\n\nCall the printer about the posters.\n');
  fs.mkdirSync(workspace('tasks'), { recursive: true });
  fs.writeFileSync(workspace('tasks', 'Inbox.md'), '# Inbox\n\n- [ ] Existing\n');
  await start();
  await openApp('Notes');
  await shell().getByRole('complementary', { name: 'Notes sidebar' }).getByRole('button', { name: 'Plan', exact: true }).click();
  const text = shell().getByRole('textbox', { name: 'Note text' });
  await expect(text).toContainText('Call the printer');
  // The whole sentence, chosen with three clicks.
  await text.getByText('Call the printer about the posters.').click({ clickCount: 3 });
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
  try {
    await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
  } catch (e) {
    // When the answer never comes (seen once on CI), say what the conversation showed instead and whether the file was written.
    const shown = await log().innerText().catch(() => '(the conversation could not be read)');
    const cards = await shell().getByRole('group', { name: /Approval needed/ }).count().catch(() => -1);
    const written = fs.existsSync(workspace('notes', 'Work', 'Ideas.md'));
    throw new Error(`${(e as Error).message}\n--- the conversation showed:\n${shown.slice(0, 2000)}\n--- approval cards still showing: ${cards}; Ideas.md written: ${written}`);
  }
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(true);
  const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
  await expect(strip).toContainText('1 change in Notes');
  // Listed from the start, a row per app saying what changed, with Show to go to it.
  await expect(strip.getByRole('listitem').filter({ hasText: 'Notes' })).toContainText('1 page');
  await expect(strip.getByRole('button', { name: 'Show in Notes' })).toBeVisible();
  await strip.getByRole('button', { name: 'Discard' }).click();
  await expect(shell().getByText('Put back as it was before that turn.')).toBeVisible();
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(false);
  expect(fs.readFileSync(workspace('notes', 'Work', 'Plan.md'), 'utf8')).toBe('# Plan\n');
});

test('earlier turns keep what they changed, each item put back as it was before its turn', async () => {
  fs.mkdirSync(workspace('notes', 'Work'), { recursive: true });
  fs.writeFileSync(workspace('notes', 'Work', 'Plan.md'), '# Plan\n');
  await start([
    callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.']),
    callsTool('files-write', { path: 'notes/Work/Plan.md', content: '# Plan\n\n- Venue\n' }), says(['Added the venue.']),
    callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n\n- Boat trip\n' }), says(['Added an idea.']),
  ]);
  const turn = async (ask: string, reply: string) => {
    await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await composer().fill(ask);
    await composer().press('Enter');
    await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
    await expect(log().locator('.msg.assistant').last()).toHaveText(reply);
  };
  await turn('make an ideas page', 'Made it.');
  await turn('add the venue to the plan', 'Added the venue.');
  const earlier = shell().getByRole('region', { name: 'Earlier changes' });
  await earlier.getByRole('button', { name: 'Earlier changes · 1 turn' }).click();
  await expect(earlier.getByRole('listitem').first()).toContainText('“make an ideas page”');
  await turn('add a boat trip idea', 'Added an idea.');
  await expect(earlier.getByRole('button', { name: /Earlier changes · 2 turns|Hide earlier changes/ })).toBeVisible();
  if (await earlier.getByRole('button', { name: /^Earlier changes/ }).isVisible()) await earlier.getByRole('button', { name: /^Earlier changes/ }).click();

  // The plan, changed only in the second turn, goes back as it was before it; the others are left.
  const second = earlier.getByRole('listitem', { name: /^Turn at/ }).filter({ hasText: 'add the venue to the plan' });
  await second.getByRole('button', { name: 'Put back Work / Plan as it was before this turn' }).click();
  // The put-back replaces the file, so for a moment it may not be there; keep polling until it is.
  const plan = () => { try { return fs.readFileSync(workspace('notes', 'Work', 'Plan.md'), 'utf8'); } catch { return null; } };
  await expect.poll(plan).toBe('# Plan\n');
  expect(fs.readFileSync(workspace('notes', 'Work', 'Ideas.md'), 'utf8')).toContain('Boat trip');

  // The ideas page changed again in the last turn, so putting back the first turn's change asks first.
  const first = earlier.getByRole('listitem', { name: /^Turn at/ }).filter({ hasText: 'make an ideas page' });
  await first.getByRole('button', { name: 'Put back Work / Ideas as it was before this turn' }).click();
  await expect(first.getByRole('alert')).toContainText('changed again after that turn');
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(true);
  await first.getByRole('button', { name: 'Put back anyway' }).click();
  await expect.poll(() => fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(false);
});

test('Keep accepts the last turn’s changes from the keyboard, and the strip stays away for that turn', async () => {
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.'])]);
  await composer().fill('make an ideas page');
  await composer().press('Enter');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
  const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
  await expect(strip.getByRole('button', { name: 'Keep' })).toBeVisible();
  // The message box is empty, so the keys are free to answer the proposal.
  await composer().press('ControlOrMeta+Enter');
  await expect(strip).toHaveCount(0);
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(true);
  await shell().reload();
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
  await expect(strip).toHaveCount(0);
});

test('the Activity tab lists a turn’s changes to review, and Discard there puts them back', async () => {
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.'])]);
  await turnEnded(composer());
  await composer().fill('make an ideas page');
  await composer().press('Enter');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
  await shell().keyboard.press('Enter');
  await shell().getByRole('navigation', { name: 'Apps' }).locator('[data-app-library]').click();
  await shell().getByRole('dialog', { name: 'Applications' }).getByRole('region', { name: 'Mobius' }).getByRole('button', { name: 'Activity', exact: true }).click();
  const activity = shell().getByRole('region', { name: 'Activity', exact: true });
  const changes = activity.getByRole('list', { name: 'Changes to review' });
  await expect(changes).toContainText('Changed 1 item');
  await changes.getByRole('button', { name: /^Discard the changes/ }).click();
  await expect(changes).toHaveCount(0);
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(false);
});

test('Rewind to here in Activity puts the apps back as they were after that turn, asks once, and can be undone', async () => {
  fs.mkdirSync(workspace('notes', 'Work'), { recursive: true });
  fs.writeFileSync(workspace('notes', 'Work', 'Plan.md'), '# Plan\n');
  await start([
    callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.']),
    callsTool('files-write', { path: 'notes/Work/Plan.md', content: '# Plan\n\n- Venue\n' }), says(['Added the venue.']),
  ]);
  for (const [ask, reply] of [['make an ideas page', 'Made it.'], ['add the venue to the plan', 'Added the venue.']] as const) {
    await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await composer().fill(ask);
    await composer().press('Enter');
    await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
    await expect(log().locator('.msg.assistant').last()).toHaveText(reply);
  }
  await openApp('Agent');
  await shell().getByRole('navigation', { name: 'Apps' }).locator('[data-app-library]').click();
  await shell().getByRole('dialog', { name: 'Applications' }).getByRole('region', { name: 'Mobius' }).getByRole('button', { name: 'Activity', exact: true }).click();
  // The Activity app's page lists the open conversation's turns.
  const activity = shell().getByRole('region', { name: 'Activity', exact: true });
  const turns = activity.getByRole('list', { name: 'Turns of this conversation' });
  const first = turns.getByRole('listitem').filter({ hasText: 'make an ideas page' });
  await first.getByRole('button', { name: 'Rewind to here' }).click();
  // Asked once, naming what goes and what changes.
  await expect(first.getByRole('group', { name: 'Rewind' })).toContainText('Rewind 1 later turn? Notes will change.');
  await first.getByRole('button', { name: 'Rewind', exact: true }).click();
  await expect(activity.getByRole('status').filter({ hasText: 'Rewound to' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(workspace('notes', 'Work', 'Plan.md'), 'utf8')).toBe('# Plan\n');
  expect(fs.existsSync(workspace('notes', 'Work', 'Ideas.md'))).toBe(true);
  await expect(turns.getByRole('listitem')).toHaveCount(1);
  await activity.getByRole('status').filter({ hasText: 'Rewound to' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.readFileSync(workspace('notes', 'Work', 'Plan.md'), 'utf8')).toContain('Venue');
  await expect(turns.getByRole('listitem')).toHaveCount(2);
});
