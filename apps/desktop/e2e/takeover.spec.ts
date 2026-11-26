import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-takeover-'));
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

test('Take over pauses Mobius at the next safe point; Hand back makes it read again and go on', async () => {
  model = await startModel([callsTool('files-read', { path: 'notes/Work/Plan.md' }), says(['Carried on.'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('Tidy my plan');
  await composer.press('Enter');
  const log = shell.getByRole('log', { name: 'Conversation' });
  const card = log.getByRole('group', { name: 'Approval needed: files.read' });
  await expect(card).toBeVisible();

  await shell.getByRole('button', { name: 'Take over' }).click();
  const bar = shell.getByRole('status', { name: 'You have control' });
  await expect(bar).toContainText('You have control · Mobius paused at step 1');
  await expect(shell.getByRole('button', { name: 'Take over' })).toHaveCount(0);
  // The read goes ahead when allowed, but Mobius does not take its next step while the apps are yours.
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.tool .tool-name')).toHaveAttribute('title', 'files.read');
  await shell.waitForTimeout(800);
  expect(model.requests).toHaveLength(1);

  // What they write as they hand back reaches Mobius as their words.
  await bar.getByRole('textbox', { name: 'Tell Mobius as you hand back' }).fill('I fixed the dates myself; only tidy the headings');
  await bar.getByRole('button', { name: 'Hand back' }).click();
  await expect(bar).toBeHidden();
  await expect(log.locator('.msg.assistant')).toContainText('Carried on.');
  const system = (model.requests[1]!.messages as Array<{ role: string; content: string }>)[0]!.content;
  expect(system).toContain('The person took over for a while');
  expect(system).toContain('I fixed the dates myself; only tidy the headings');
});

test('Stop on the control bar ends the task', async () => {
  model = await startModel([callsTool('files-read', { path: 'notes/Work/Plan.md' }), says(['never'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('Tidy my plan');
  await composer.press('Enter');
  await expect(shell.getByRole('group', { name: 'Approval needed: files.read' })).toBeVisible();
  await shell.getByRole('button', { name: 'Take over' }).click();
  const bar = shell.getByRole('status', { name: 'You have control' });
  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toBeHidden();
  await expect(shell.getByRole('button', { name: 'Send', includeHidden: true })).toBeAttached();
});

test('a tab Mobius drives says so, becomes Yours on Take over, and is Mobius’s again on Hand back', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  model = await startModel([
    callsTool('browser-open', { url: fixture.origin + '/second' }),
    callsTool('files-read', { path: 'notes/Work/Plan.md' }),
    says(['Done with the page.']),
  ]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('Look at the second page');
  await composer.press('Enter');
  const log = shell.getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: browser.open' }).getByRole('button', { name: 'Allow once' }).click();
  const tab = shell.locator('.tab', { hasText: 'Second page' });
  await expect(tab.locator('.tab-driver')).toHaveText('Mobius');
  await expect(log.getByRole('group', { name: 'Approval needed: files.read' })).toBeVisible();

  await shell.getByRole('button', { name: 'Take over' }).click();
  await expect(tab.locator('.tab-driver')).toHaveText('Yours');
  await shell.getByRole('status', { name: 'You have control' }).getByRole('button', { name: 'Hand back' }).click();
  await expect(tab.locator('.tab-driver')).toHaveText('Mobius');

  await log.getByRole('group', { name: 'Approval needed: files.read' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('Done with the page.');
  await expect(tab.locator('.tab-driver')).toHaveCount(0);
});

test('typing in the note Mobius is working in pauses it; Resume on its pill carries on', async () => {
  test.setTimeout(90_000);
  // It writes a note beside the plan, then takes its time over the next one: meanwhile the person types in the plan.
  const slowStep = { chunks: [
    { data: { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_2', function: { name: 'files-write', arguments: JSON.stringify({ path: 'notes/Work/Step3.md', content: '# Step3\n' }) } }] } }] }, pauseMs: 2500 },
    { data: { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }, pauseMs: 0 },
  ] };
  model = await startModel([
    callsTool('files-write', { path: 'notes/Work/Alpha.md', content: '# Alpha\n' }), slowStep,
    // Handed back, it reads what is there again and writes the next note after all.
    callsTool('files-write', { path: 'notes/Work/Step3.md', content: '# Step3\n' }), says(['Carried on.']),
  ]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell.keyboard.press('Enter');
  await shell.getByRole('complementary', { name: 'Notebooks' }).getByRole('button', { name: 'Plan', exact: true }).click();
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  if (!(await composer.isVisible())) await shell.keyboard.press('Control+Shift+M');
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  // Its steps run without asking, so the one in hand while the person types is running, not waiting on them.
  await shell.evaluate(() => window.mobius.preferences.set({ approvalMode: 'off' }));
  await composer.fill('Tidy my plan');
  await composer.press('Enter');
  const log = shell.getByRole('log', { name: 'Conversation' });
  await expect.poll(() => model!.requests.length).toBe(2);

  // Typing in the message box does not pause it; typing in the note it is working in does, at once.
  await composer.click();
  await shell.keyboard.type('a');
  await shell.waitForTimeout(300);
  await expect(shell.getByRole('status', { name: 'You have control' })).toHaveCount(0);
  await composer.fill('');
  const text = shell.getByRole('textbox', { name: 'Note text' });
  // Once the note has taken in the step that read it.
  await shell.waitForTimeout(800);
  await text.click();
  await shell.keyboard.type('x');
  await expect(shell.getByRole('status').filter({ hasText: 'Paused Mobius while you type' })).toBeVisible();
  await expect(shell.getByRole('status', { name: 'You have control' })).toBeVisible();

  // The step it was taking waits as Paused, not Running, and nothing claims Mobius is working.
  await expect(log.locator('.tool-status', { hasText: 'Paused' })).toHaveCount(1, { timeout: 8000 });
  await expect(log.locator('.tool-status', { hasText: 'Running' })).toHaveCount(0);

  // With the panel closed, its pill says Paused and offers Resume.
  await shell.getByRole('button', { name: 'Hide Mobius' }).click();
  const pill = shell.locator('.working-pill');
  await expect(pill).toContainText('Paused');
  await expect(pill.getByRole('button', { name: 'Pause Mobius' })).toHaveCount(0);
  await shell.waitForTimeout(3000);
  expect(model.requests).toHaveLength(2);
  await expect(pill).toContainText(/at step \d/);
  // While paused, the note is theirs to write in; resumed straight after, before the note would save on its own.
  await text.click();
  await shell.keyboard.type('Booked the venue myself');
  // From the keyboard, Resume hands the focus to the pill rather than to nothing.
  await pill.getByRole('button', { name: 'Resume' }).focus();
  await shell.keyboard.press('Enter');
  await expect(pill.filter({ hasText: 'Paused' })).toHaveCount(0);
  await expect.poll(() => shell.evaluate(() => document.activeElement?.closest('.working-pill, .strip-mobius') != null)).toBe(true);
  await shell.getByRole('button', { name: 'Show Mobius' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('Carried on.');
  const system = (model.requests[2]!.messages as Array<{ role: string; content: string }>)[0]!.content;
  expect(system).toContain('The person took over for a while');
  // The step Mobius did not run says so, and what the person typed meanwhile is theirs, not the turn's to review:
  // only Mobius's two notes are listed, and the turn's Undo leaves the plan as they wrote it.
  await expect(log.locator('.tool-status', { hasText: 'Not run: you took over' })).toHaveCount(1);
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Plan.md'), 'utf8')).toContain('Booked the venue myself');
  const summary = shell.getByRole('region', { name: 'Changes from the last turn' });
  await expect(summary.locator('.turn-summary-count')).toHaveText('2 changes');
});
