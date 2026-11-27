import { expect, test, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

const OLD_LINE = '  const each = cents / people\n  return Array.from({ length: people }, () => Math.round(each) / 100)';
const NEW_LINE = '  const each = Math.floor(cents / people)\n  const extra = cents - each * people\n  return Array.from({ length: people }, (_, i) => (each + (i < extra ? 1 : 0)) / 100)';
const BUDGET = `// Split a total evenly, in cents\nexport function splitTotal(total, people) {\n  const cents = Math.round(total * 100)\n${OLD_LINE}\n}\n`;
const TEST = `import { splitTotal } from '../src/budget.js'
const sum = Math.round(splitTotal(5420, 7).reduce((a, b) => a + b, 0) * 100) / 100
console.log('✓ splits 5420 across 7')
if (sum !== 5420) { console.log('✕ shares always add back to the total, got ' + sum.toFixed(2)); process.exit(1) }
console.log('✓ shares always add back to the total')
`;

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
let project: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-code-'));
  project = path.join(userData, 'workspace', 'code', 'offsite-planner');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(project, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'budget.js'), BUDGET);
  fs.writeFileSync(path.join(project, 'tests', 'budget.test.js'), TEST);
  fs.writeFileSync(path.join(project, 'package.json'), '{ "type": "module" }\n');
});
test.afterEach(async ({}, info) => {
  // A failure says what Code showed, since the trace stays on the CI machine.
  if (info.status !== info.expectedStatus && mobius) {
    const seen = await mobius.shell.locator('section[aria-label="Code"]').ariaSnapshot({ timeout: 2_000 }).catch((e: Error) => `(no snapshot: ${e.message})`);
    const changes = await mobius.shell.getByRole('region', { name: 'Changes' }).ariaSnapshot({ timeout: 2_000 }).catch(() => '(no Changes bar)');
    console.log(`[e2e code] ${info.title}: what Code showed\n${seen.slice(0, 4000)}\n${changes.slice(0, 2000)}`);
  }
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const files = (): Locator => shell().getByRole('tree', { name: 'Files in offsite-planner' });
const tests = (): Locator => shell().getByRole('region', { name: 'Tests' });
const budget = () => fs.readFileSync(path.join(project, 'src', 'budget.js'), 'utf8');

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Code');
  await shell().keyboard.press('Enter');
  await expect(files()).toBeVisible();
  await files().getByRole('treeitem', { name: 'src', exact: true }).click();
  await files().getByRole('treeitem', { name: 'src/budget.js' }).click();
}

test('a project is real files: typed and saved, and its tests run with the command the person chose', async () => {
  await start();
  const editor = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  await expect(editor).toHaveValue(BUDGET);
  await editor.focus();
  await shell().keyboard.press('Control+End');
  await shell().keyboard.type('export const people = 7\n');
  await expect(shell().getByRole('status').filter({ hasText: 'Not saved' })).toBeVisible();
  await shell().keyboard.press('Control+s');
  await expect.poll(budget).toBe(`${BUDGET}export const people = 7\n`);

  // Nothing runs until the person chooses the command; one is suggested from the project's files.
  await expect(tests()).toContainText('such as npm test');
  await tests().getByRole('button', { name: 'Choose command' }).click();
  await expect(tests().getByRole('textbox', { name: 'Test command' })).toHaveValue('npm test');
  await tests().getByRole('textbox', { name: 'Test command' }).fill('node tests/budget.test.js');
  await tests().getByRole('button', { name: 'Save' }).click();
  await tests().getByRole('button', { name: 'Run' }).click();
  await expect(tests().getByRole('status')).toContainText('Failed');
  await expect(tests().getByLabel('Test output')).toContainText('✕ shares always add back to the total, got 5420.03');
  expect(JSON.parse(fs.readFileSync(path.join(userData, 'code-tests.json'), 'utf8'))).toEqual({ 'offsite-planner': 'node tests/budget.test.js' });

  // A new file, in the folder of the open one.
  await shell().getByRole('button', { name: 'New file' }).click();
  await shell().getByRole('textbox', { name: 'File name' }).fill('src/types.js');
  await shell().getByRole('textbox', { name: 'File name' }).press('Enter');
  await expect(files().getByRole('treeitem', { name: 'src/types.js' })).toHaveAttribute('aria-selected', 'true');
  expect(fs.existsSync(path.join(project, 'src', 'types.js'))).toBe(true);

  // With every tab closed, the start page offers the files opened lately, newest first (closing types.js showed budget.js).
  await shell().getByRole('button', { name: 'Close src/types.js' }).click();
  await shell().getByRole('button', { name: 'Close src/budget.js' }).click();
  const recent = shell().getByRole('region', { name: 'Recent files' });
  await expect(recent.getByRole('button')).toHaveText([/budget\.js/, /types\.js/]);
  await recent.getByRole('button', { name: /budget\.js/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Contents of src/budget.js' })).toBeVisible();
});

test('the agent fixes a failing test as a suggested change, runs the tests, and the person keeps or discards it', async () => {
  fs.writeFileSync(path.join(userData, 'code-tests.json'), JSON.stringify({ 'offsite-planner': 'node tests/budget.test.js' }));
  await start([
    callsTool('code-test', { project: 'offsite-planner' }),
    callsTool('files-edit', { path: 'code/offsite-planner/src/budget.js', old: OLD_LINE, new: NEW_LINE }),
    callsTool('code-test', { project: 'offsite-planner' }),
    says(['Every share rounded up the same leftover fraction. I split the cents exactly and hand the remainder out one at a time.']),
    callsTool('files-edit', { path: 'code/offsite-planner/src/budget.js', old: 'people) {', new: 'people) {\n  // Shares add back to the total' }),
    says(['Added a comment.']),
  ]);
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Why is the split test off by 3 cents?');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  // Running the tests needs no asking: it runs only the command the person chose. Changing a file asks.
  await log.getByRole('group', { name: 'Approval needed: files.edit' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('hand the remainder out one at a time');
  await expect(tests().getByRole('status')).toContainText('Passed');
  await expect(tests().getByRole('status')).toContainText('run by Mobius');

  const change = shell().getByRole('region', { name: 'Suggested change' });
  await expect(change.locator('.code-line[data-kind="del"]')).toHaveCount(2);
  await expect(change.locator('.code-line[data-kind="add"]')).toHaveCount(3);
  await expect(files().getByRole('treeitem', { name: 'src/budget.js' }).getByRole('img', { name: 'Changed by the agent' })).toBeVisible();
  await change.getByRole('button', { name: /^Keep/ }).click();
  await expect(change).toBeHidden();
  await expect(shell().getByRole('textbox', { name: 'Contents of src/budget.js' })).toHaveValue(BUDGET.replace(OLD_LINE, NEW_LINE));

  // The next change is discarded: the file is as it was before it.
  await composer.fill('Add a comment');
  await composer.press('Enter');
  await log.getByRole('group', { name: 'Approval needed: files.edit' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(change.locator('.code-line[data-kind="add"]')).toHaveText(/Shares add back to the total/);
  await change.getByRole('button', { name: /^Discard/ }).click();
  await expect.poll(budget).toBe(BUDGET.replace(OLD_LINE, NEW_LINE));
  await expect(change).toBeHidden();
});

test('a project that is a git repository is committed from Code, and Mobius commits only when allowed', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await start([callsTool('code-commit', { project: 'offsite-planner', message: 'Split cents exactly' }), says(['Committed.'])]);
  const bar = shell().getByRole('region', { name: 'Changes' });
  await expect(bar).toContainText('main');
  await expect(bar.getByRole('status')).toHaveText('3 changes');
  // Each changed file is listed with git's mark: here all three are new to git.
  const changes = bar.getByRole('list', { name: 'Changed files' });
  await expect(changes.getByRole('listitem')).toHaveCount(3);
  await expect(changes.getByRole('button', { name: 'src/budget.js, not tracked by git yet' })).toBeVisible();
  await bar.getByRole('button', { name: 'Commit…' }).click();
  await bar.getByRole('textbox', { name: 'Commit message' }).fill('Start the offsite planner');
  await bar.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(bar.getByRole('status')).toHaveText('Nothing to commit');
  expect(git('log', '--format=%s')).toBe('Start the offsite planner');

  fs.writeFileSync(path.join(project, 'src', 'budget.js'), BUDGET.replace(OLD_LINE, NEW_LINE));
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Commit the fix');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: code.commit' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toHaveText('Committed.');
  expect(git('log', '--format=%s')).toBe('Split cents exactly\nStart the offsite planner');
  await expect(bar.getByRole('status')).toHaveText('Nothing to commit');
});

test('the console runs the person\'s commands in the project, and Mobius runs one only when asked each time', async () => {
  await start([callsTool('code-run', { project: 'offsite-planner', command: 'node --version' }), says(['Node is installed.'])]);
  // Console is a bottom panel beside Tests, shown from the Panels menu.
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'View', exact: true }).click();
  await shell().getByRole('menuitemcheckbox', { name: 'Console' }).click();
  const console_ = shell().getByRole('region', { name: 'Console' });
  await console_.getByRole('textbox', { name: 'Command' }).fill('node -e "console.log(require(\'fs\').readdirSync(\'src\').join())"');
  await console_.getByRole('button', { name: 'Run' }).click();
  await expect(console_.getByRole('log', { name: 'Console output' })).toContainText('budget.js');

  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Which Node is this?');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: code.run' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toHaveText('Node is installed.');
  await expect(console_.getByRole('log', { name: 'Console output' })).toContainText('Mobius › node --version');
  await expect(console_.getByRole('log', { name: 'Console output' })).toContainText(/v\d+\./);
});

test('a command can keep running, its output shows as it comes, and it stops when asked', async () => {
  await start([
    callsTool('code-start', { project: 'offsite-planner', command: 'node -e "setInterval(() => console.log(\'serving\'), 200)"' }),
    callsTool('code-output', { id: '{{request:Started as command ([0-9]+)}}' }),
    callsTool('code-stop', { id: '{{request:Started as command ([0-9]+)}}' }),
    says(['The server printed serving; I stopped it.']),
  ]);
  // Console is a bottom panel beside Tests, shown from the Panels menu.
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'View', exact: true }).click();
  await shell().getByRole('menuitemcheckbox', { name: 'Console' }).click();
  const console_ = shell().getByRole('region', { name: 'Console' });
  await console_.getByRole('checkbox', { name: 'Keep running' }).check();
  await console_.getByRole('textbox', { name: 'Command' }).fill('node -e "setInterval(() => console.log(\'tick\'), 200)"');
  await console_.getByRole('button', { name: 'Start' }).click();
  const running = console_.getByRole('list', { name: 'Running' });
  await expect(running.getByRole('listitem').first()).toContainText('tick');
  await expect(running.getByRole('listitem')).toHaveCount(1);
  await expect(running.getByRole('listitem').first().getByRole('status')).toHaveText('Running');
  await running.getByRole('button', { name: /^Stop / }).first().click();
  await expect(running.getByRole('listitem').first().getByRole('status')).toHaveText('Stopped');

  // Mobius starting one is asked about; reading and stopping it are not.
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Start the server and check it');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: code.start' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toHaveText('The server printed serving; I stopped it.');
  await expect(log.getByRole('group', { name: /Approval needed/ })).toHaveCount(0);
  await expect(running.getByRole('listitem').filter({ hasText: 'serving' }).getByRole('status')).toHaveText('Stopped');
  await expect(running.getByRole('listitem')).toHaveCount(2);
});

test('files open as tabs that keep what was typed; quick open, find and comment work from the keys', async () => {
  await start();
  const editor = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  await expect(editor).toHaveValue(BUDGET);
  await editor.focus();
  await shell().keyboard.press('Control+End');
  await shell().keyboard.type('const typed = splitTotal(');
  // The bracket closes itself.
  await expect(editor).toHaveValue(`${BUDGET}const typed = splitTotal()`);

  // Quick open finds the test file by part of its name; the first tab keeps its unsaved text.
  await shell().keyboard.press('Control+p');
  await shell().getByRole('combobox', { name: 'File to open' }).fill('btest');
  await shell().keyboard.press('Enter');
  await expect(shell().getByRole('textbox', { name: 'Contents of tests/budget.test.js' })).toHaveValue(TEST);
  const tabs = shell().getByRole('tablist', { name: 'Open files' });
  await expect(tabs.getByRole('tab')).toHaveText(['budget.js', 'budget.test.js']);
  await expect(tabs.getByRole('button', { name: 'Close src/budget.js (not saved)' })).toBeVisible();
  await tabs.getByRole('tab', { name: 'budget.js', exact: false }).first().click();
  await expect(editor).toHaveValue(`${BUDGET}const typed = splitTotal()`);
  expect(budget()).toBe(BUDGET);

  // Ctrl+/ comments the line the cursor is on, and Ctrl+Z takes it back.
  await editor.focus();
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.press('Control+/');
  await expect(editor).toHaveValue(new RegExp('^// Split a total evenly, in cents\\n// export function splitTotal'));
  await shell().keyboard.press('Control+z');
  await expect(editor).toHaveValue(`${BUDGET}const typed = splitTotal()`);

  // Find counts the matches; closing the tab drops the unsaved text.
  await shell().keyboard.press('Control+f');
  await shell().getByRole('textbox', { name: 'Find in file' }).fill('people');
  await expect(shell().getByRole('search', { name: 'Find in file' })).toContainText('1 of 3');
  await shell().keyboard.press('Escape');
  await tabs.getByRole('button', { name: 'Close src/budget.js (not saved)' }).click();
  await expect(tabs.getByRole('tab')).toHaveText(['budget.test.js']);
  expect(budget()).toBe(BUDGET);
});

test('Outline, on the right, lists what the open file defines and goes to its line', async () => {
  await start();
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'View', exact: true }).click();
  await shell().getByRole('menuitemcheckbox', { name: 'Outline' }).click();
  const outline = shell().getByRole('list', { name: 'What this file defines' });
  await outline.getByRole('button', { name: /splitTotal/ }).click();
  await expect(shell().getByText('Ln 2, Col 1')).toBeVisible();
});

test('the editor has many cursors, moves lines, places the cursor with the pointer and stays quick in a long file', async () => {
  const long = Array.from({ length: 20_000 }, (_, i) => `const line${i} = ${i} // a comment`).join('\n');
  fs.writeFileSync(path.join(project, 'src', 'long.js'), `${long}\n`);
  await start();
  const editor = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  await expect(editor).toHaveValue(BUDGET);
  await editor.focus();

  // Ctrl+D picks the word under the cursor, then its next two uses (wrapping round to the top); typing changes all three at once, and one undo puts them back.
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.press('End');
  await shell().keyboard.press('Control+ArrowLeft');
  for (let i = 0; i < 3; i += 1) await shell().keyboard.press('Control+d');
  await expect(shell().getByText('3 cursors', { exact: false })).toBeVisible();
  await shell().keyboard.type('guests');
  await expect(editor).toHaveValue(BUDGET.replaceAll('people', 'guests'));
  await shell().keyboard.press('Control+z');
  await expect(editor).toHaveValue(BUDGET);
  await shell().keyboard.press('Escape');
  await expect(shell().getByText('cursors', { exact: false })).toHaveCount(0);

  // Alt+Up moves the line with the cursor above the one before it; Shift+Alt+Down copies it.
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.press('Alt+ArrowUp');
  const lines = BUDGET.split('\n');
  await expect(editor).toHaveValue([lines[1], lines[0], ...lines.slice(2)].join('\n'));
  await shell().keyboard.press('Control+z');
  await shell().keyboard.press('Shift+Alt+ArrowDown');
  await expect(editor).toHaveValue([lines[0], lines[1], lines[1], ...lines.slice(2)].join('\n'));
  await shell().keyboard.press('Control+z');
  await expect(editor).toHaveValue(BUDGET);

  // A click puts the cursor where it lands.
  await shell().locator('.ed-line').nth(2).click({ position: { x: 4, y: 10 } });
  await expect(shell().getByText('Ln 3, Col 1')).toBeVisible();

  // A 20,000-line file draws only the lines in view, and typing at its end shows at once.
  await shell().keyboard.press('Control+p');
  await shell().getByRole('combobox', { name: 'File to open' }).fill('long.js');
  await shell().keyboard.press('Enter');
  const big = shell().getByRole('textbox', { name: 'Contents of src/long.js' });
  await expect(big).toHaveValue(`${long}\n`);
  expect(await shell().locator('.ed-line').count()).toBeLessThan(200);
  await big.focus();
  await shell().keyboard.press('Control+End');
  const started = Date.now();
  await shell().keyboard.type('done');
  await expect(big).toHaveValue(`${long}\ndone`);
  expect(Date.now() - started).toBeLessThan(3_000);
  await expect(shell().getByText('Ln 20001, Col 5')).toBeVisible();
});

const servePreview = async (): Promise<string> => {
  fs.writeFileSync(path.join(project, 'index.html'), '<title>Offsite</title><h1>Offsite planner</h1>');
  await start();
  return shell().evaluate(async () => {
    const got = await window.mobius.code!.preview!('offsite-planner');
    if (!('url' in got)) throw new Error(got.message);
    return got.url;
  });
};
const openBeside = (url: string) => shell().evaluate((u) => window.dispatchEvent(new CustomEvent('mobius:open-beside', { detail: { app: 'browser', url: u } })), url);

test('a project\'s page is served on this computer only, and the Browser opens beside Code', async () => {
  const url = await servePreview();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  // The served page is the project's own file; nothing outside the folder, and no other name for this computer.
  expect(await (await fetch(url)).text()).toContain('Offsite planner');
  expect((await fetch(`${url}%2e%2e/code-tests.json`)).status).toBe(404);
  // Code asks the shell for the Browser beside it: Code stays where it is, the Browser takes the other pane.
  await openBeside(url);
  await expect(shell().getByRole('region', { name: 'Left pane: Code' })).toBeVisible();
  await expect(shell().getByRole('region', { name: 'Right pane: Browser' })).toBeVisible();
  // Asked again, nothing moves.
  await openBeside(url);
  await expect(shell().getByRole('region', { name: 'Left pane: Code' })).toBeVisible();
  await shell().evaluate(() => window.mobius.code!.stopPreview!('offsite-planner'));
  await expect.poll(() => fetch(url).then(() => 'up', () => 'down')).toBe('down');
});

test('the preview\'s page tells Code its errors and the element the person picks', async () => {
  fs.writeFileSync(path.join(project, 'app.js'), 'document.title = "Ready";\nmissingThing();\n');
  const url = await servePreview();
  fs.writeFileSync(path.join(project, 'index.html'), '<title>Offsite</title><h1 class="hero">Offsite planner</h1><script src="app.js"></script>');
  await shell().evaluate(() => {
    const seen: unknown[] = [];
    (window as unknown as { previewReports: unknown[] }).previewReports = seen;
    window.mobius.code!.onPreview!((r) => seen.push(r));
  });
  const reports = () => shell().evaluate(() => (window as unknown as { previewReports: Array<Record<string, unknown>> }).previewReports);
  // The page itself, as any browser shows it.
  const page = await shell().context().newPage();
  await page.goto(url);
  await expect.poll(async () => (await reports()).find((r) => r.kind === 'error')).toMatchObject({ project: 'offsite-planner', kind: 'error', source: '/app.js', line: 2 });
  expect(String((await reports()).find((r) => r.kind === 'error')!.message)).toContain('missingThing');
  // Code asks for a pick; the person clicks the heading in the page.
  await expect.poll(() => shell().evaluate(async () => { const got = await window.mobius.code!.previewSay!('offsite-planner', 'pick'); return 'pages' in got ? got.pages : -1; })).toBe(1);
  await page.locator('h1').click();
  await expect.poll(async () => (await reports()).find((r) => r.kind === 'pick')).toMatchObject({ kind: 'pick', selector: 'h1.hero', tag: 'h1', text: 'Offsite planner', path: '/' });
  // Reload on save: the page loads again.
  const loads = async () => (await reports()).filter((r) => r.kind === 'loaded').length;
  const before = await loads();
  await shell().evaluate(() => window.mobius.code!.previewSay!('offsite-planner', 'reload'));
  await expect.poll(loads).toBeGreaterThan(before);
  // When the preview stops, the open page says so rather than looking live.
  await shell().evaluate(() => window.mobius.code!.stopPreview!('offsite-planner'));
  await expect(page.getByRole('status')).toHaveText('This preview has stopped. Open Preview in Code to see the page again.');
  await page.close();
});

test('the preview page opens as a tab in the Browser beside Code, once', { tag: '@shell', annotation: { type: 'needs the shell', description: 'the browser\'s pages are the shell\'s' } }, async () => {
  const url = await servePreview();
  await openBeside(url);
  const right = shell().getByRole('region', { name: 'Right pane: Browser' });
  // In half the window the Browser starts without its tabs, so the page keeps the pane's room.
  await expect(right.getByRole('complementary', { name: 'Tabs' })).toBeHidden();
  const titles = () => shell().evaluate(async () => (await window.mobius.browser.getState()).tabs.map((t) => t.title));
  await expect.poll(titles).toEqual(['Fixture home', 'Offsite']);
  await openBeside(url);
  await expect.poll(titles).toEqual(['Fixture home', 'Offsite']);
});

test('find and replace changes one match or all of them, by whole word or pattern, and select all makes them cursors', async () => {
  await start();
  const editor = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  await expect(editor).toHaveValue(BUDGET);
  await editor.focus();
  await shell().keyboard.press('Control+h');
  const bar = shell().getByRole('search', { name: 'Find in file' });
  await bar.getByRole('textbox', { name: 'Find in file' }).fill('people');
  await expect(bar).toContainText('1 of 3');
  await bar.getByRole('textbox', { name: 'Replace with' }).fill('guests');
  await bar.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(editor).toHaveValue(BUDGET.replace('people', 'guests'));
  await expect(bar).toContainText('1 of 2');
  await bar.getByRole('button', { name: 'Replace all' }).click();
  await expect(editor).toHaveValue(BUDGET.replaceAll('people', 'guests'));
  // Replace all is one step for undo.
  await editor.focus();
  await shell().keyboard.press('Control+z');
  await expect(editor).toHaveValue(BUDGET.replace('people', 'guests'));
  await shell().keyboard.press('Control+z');
  await expect(editor).toHaveValue(BUDGET);

  // A regular expression, with its groups in the replacement.
  await shell().keyboard.press('Control+h');
  await bar.getByRole('button', { name: 'Regular expression' }).click();
  await bar.getByRole('textbox', { name: 'Find in file' }).fill('(\\w+) \\* 100');
  await expect(bar).toContainText('1 of 1');
  await bar.getByRole('textbox', { name: 'Replace with' }).fill('100 * $1');
  await bar.getByRole('button', { name: 'Replace all' }).click();
  await expect(editor).toHaveValue(BUDGET.replace('total * 100', '100 * total'));
  await bar.getByRole('textbox', { name: 'Find in file' }).fill('(');
  await expect(bar).toContainText('Not a pattern');

  // Alt+Enter selects every match as a cursor, so typing changes them all.
  await bar.getByRole('button', { name: 'Regular expression' }).click();
  await bar.getByRole('textbox', { name: 'Find in file' }).fill('each');
  await shell().keyboard.press('Alt+Enter');
  await expect(shell().getByText('2 cursors', { exact: false })).toBeVisible();
  await shell().keyboard.type('share');
  await expect(editor).toHaveValue(BUDGET.replace('total * 100', '100 * total').replaceAll('each', 'share'));

  // The bracket at the cursor and its partner are boxed.
  await shell().keyboard.press('Escape');
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.press('End');
  await expect(shell().locator('.ed-bracket')).toHaveCount(2);
});

test('regions fold from the gutter or the keys, the scope stays at the top while scrolling, and Ctrl+Shift+O goes to a symbol', async () => {
  const body = Array.from({ length: 80 }, (_, i) => `  const step${i} = ${i}`).join('\n');
  fs.writeFileSync(path.join(project, 'src', 'plan.js'), `function first() {\n${body}\n}\n\nfunction second() {\n  return 2\n}\n`);
  await start();
  await shell().keyboard.press('Control+p');
  await shell().getByRole('combobox', { name: 'File to open' }).fill('plan.js');
  await shell().keyboard.press('Enter');
  const editor = shell().getByRole('textbox', { name: 'Contents of src/plan.js' });
  await expect(editor).toHaveValue(/^function first/);

  // The gutter's fold button hides the body; the line after it is drawn right below.
  await shell().getByRole('button', { name: 'Fold lines 2 to 81' }).dispatchEvent('mousedown');
  await expect(shell().locator('.ed-fold-more')).toHaveCount(1);
  await expect(shell().locator('.ed-line').nth(1)).toHaveText('}');
  // Its ⋯ opens it again.
  await shell().locator('.ed-fold-more').dispatchEvent('mousedown');
  await expect(shell().locator('.ed-fold-more')).toHaveCount(0);

  // Ctrl+Shift+[ folds the region the cursor is in and leaves the cursor on its first line; Down skips the folded lines.
  await editor.focus();
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.press('ArrowDown');
  await shell().keyboard.press('Control+Shift+BracketLeft');
  await expect(shell().getByText('Ln 1, Col 19')).toBeVisible();
  await shell().keyboard.press('ArrowDown');
  await expect(shell().getByText('Ln 82, Col 1')).toBeVisible();
  await shell().keyboard.press('ArrowUp');
  await shell().keyboard.press('Control+Shift+BracketRight');
  await expect(shell().locator('.ed-fold-more')).toHaveCount(0);

  // Scrolled into the body, its function's first line stays at the top.
  await shell().locator('.ed-scroll').evaluate((el) => { el.scrollTop = 600; el.dispatchEvent(new Event('scroll')); });
  await expect(shell().locator('.ed-sticky-line')).toHaveText(['function first() {']);

  // Go to a symbol.
  await editor.focus();
  await shell().keyboard.press('Control+Shift+o');
  await shell().getByRole('combobox', { name: 'Symbol to go to' }).fill('second');
  await shell().keyboard.press('Enter');
  await expect(shell().getByText('Ln 84, Col 1')).toBeVisible();
});

test('a change made outside the editor, such as Revert, is one more step for undo, so undo never mixes up the text', async () => {
  await start();
  const editor = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  await expect(editor).toHaveValue(BUDGET);
  await editor.focus();
  await shell().keyboard.press('Control+End');
  await shell().keyboard.type('const a = 1');
  await shell().getByRole('button', { name: 'Revert' }).click();
  await expect(editor).toHaveValue(BUDGET);
  await editor.focus();
  await shell().keyboard.press('Control+z');
  await expect(editor).toHaveValue(`${BUDGET}const a = 1`);
  await shell().keyboard.press('Control+z');
  await expect(editor).toHaveValue(BUDGET);
});

test('a language server on the computer brings problems, completions, hover, go to definition, rename and format on save', async () => {
  // The project brings its own server (a stand-in that answers from the text), as a project's node_modules can.
  const bin = path.join(project, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  const fake = path.resolve(import.meta.dirname, 'fixtures', 'fake-language-server.js');
  fs.writeFileSync(path.join(bin, 'typescript-language-server'), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'typescript-language-server.cmd'), `@"${process.execPath}" "${fake}" %*\r\n`);
  await start();
  const editor = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  const status = shell().getByRole('contentinfo', { name: 'Where the cursor is' }).or(shell().locator('footer.code-status'));
  await expect(editor).toHaveValue(BUDGET);
  await expect(status.getByRole('button', { name: 'Format on save' })).toBeVisible({ timeout: 15_000 });
  await expect(status.getByRole('button', { name: 'Problems: 0 errors, 0 warnings' })).toBeVisible();

  // Completions come as you type after a dot; Enter puts one in, its first stop where the cursor lands.
  await editor.focus();
  await shell().keyboard.press('Control+End');
  await shell().keyboard.type('cents.');
  const list = shell().getByRole('listbox', { name: 'Completions' });
  await expect(list.getByRole('option', { name: /toFixed/ })).toHaveAttribute('aria-selected', 'true');
  await shell().keyboard.press('ArrowDown');
  await expect(list.getByRole('option', { name: /toString/ })).toHaveAttribute('aria-selected', 'true');
  await shell().keyboard.press('ArrowUp');
  await shell().keyboard.press('Enter');
  await expect(list).toBeHidden();
  let text = `${BUDGET}cents.toFixed(digits)`;
  await expect(editor).toHaveValue(text);
  await expect(status).toContainText('Ln 7, Col 15');

  // A problem is underlined, counted, listed in Problems, and F8 shows its message where it is.
  await shell().keyboard.press('End');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('// TODO tidy');
  text += '\n// TODO tidy';
  await expect(editor).toHaveValue(text);
  await expect(shell().locator('.ed-problem')).toHaveCount(1);
  await status.getByRole('button', { name: 'Problems: 1 errors, 0 warnings' }).click();
  await shell().getByRole('button', { name: /Finish this TODO/ }).click();
  await expect(status).toContainText('Ln 8, Col 4');
  await editor.focus();
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.press('F8');
  await expect(status).toContainText('Ln 8, Col 4');
  await expect(shell().getByRole('status').filter({ hasText: 'Finish this TODO' })).toBeVisible();

  // Resting the pointer on a word shows what the server says of it.
  // A place in the text, as the pointer finds it: the line's box and the width of one character.
  const at = async (line: number, word: string) => {
    const box = (await shell().locator('.ed-line').nth(line).boundingBox())!;
    const cw = await shell().locator('.ed-measure').evaluate((el) => el.getBoundingClientRect().width / 20);
    const col = text.split('\n')[line]!.indexOf(word) + 1;
    return { x: box.x + 8 + col * cw, y: box.y + box.height / 2 };
  };
  const cents = await at(3, 'cents');
  await shell().mouse.move(cents.x, cents.y);
  await expect(shell().locator('.ed-hover')).toContainText('const cents: number');

  // F12 goes to where a word is first defined.
  const people = await at(3, 'people');
  await shell().mouse.click(people.x, people.y);
  await shell().keyboard.press('F12');
  await expect(status).toContainText(`Ln 2, Col ${BUDGET.split('\n')[1]!.indexOf('people') + 1}`);

  // F2 renames it everywhere.
  await shell().keyboard.press('F2');
  const name = shell().getByRole('textbox', { name: 'New name' });
  await expect(name).toHaveValue('people');
  await name.fill('guests');
  await name.press('Enter');
  text = text.replaceAll('people', 'guests');
  await expect(editor).toHaveValue(text);

  // Format on save: trailing spaces typed at the end are gone from what is saved.
  await status.getByRole('button', { name: 'Format on save' }).click();
  await expect(status.getByRole('button', { name: 'Format on save' })).toHaveAttribute('aria-pressed', 'true');
  await editor.focus();
  await shell().keyboard.press('Control+End');
  await shell().keyboard.type('   ');
  await shell().keyboard.press('Control+s');
  await expect.poll(budget).toBe(text);
  await expect(editor).toHaveValue(text);
});

test('lines changed since the last commit are marked in the gutter, and one change can be put back', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  await start();
  const editor = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  await expect(editor).toHaveValue(BUDGET);
  await expect(shell().locator('.ed-change')).toHaveCount(0);
  await editor.focus();
  // Line 4 changed, a line added after it, and the first line deleted.
  await shell().keyboard.press('Control+g');
  await shell().getByRole('textbox', { name: 'Line number' }).fill('4');
  await shell().keyboard.press('Enter');
  await shell().keyboard.press('End');
  await shell().keyboard.type(' // shares');
  await shell().keyboard.press('Enter');
  await shell().keyboard.type('const spare = 0');
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.press('Control+Shift+k');
  await expect(shell().getByRole('button', { name: 'Lines 3 to 4 changed since the last commit' })).toBeAttached();
  await expect(shell().getByRole('button', { name: '1 line deleted here since the last commit' })).toBeAttached();
  // Alt+F5 shows the next change with what was there, and Revert this change puts it back.
  await shell().keyboard.press('Alt+F5');
  const peek = shell().getByRole('dialog', { name: 'Change since the last commit' });
  await expect(peek.getByLabel('What was there')).toContainText('const each = cents / people');
  await peek.getByRole('button', { name: 'Revert this change' }).click();
  await expect(editor).toHaveValue(BUDGET.slice(BUDGET.indexOf('\n') + 1));
  await expect(shell().getByRole('button', { name: /changed since the last commit/ })).toHaveCount(0);
  await editor.focus();
  await shell().keyboard.press('Alt+F5');
  await peek.getByRole('button', { name: 'Revert this change' }).click();
  await expect(editor).toHaveValue(BUDGET);
  await expect(shell().locator('.ed-change')).toHaveCount(0);
});

test('Preview shows the page beside Code, saving reloads it, its error goes to its line, and Pick goes to an element\'s code', async () => {
  fs.writeFileSync(path.join(project, 'app.js'), 'document.title = "Ready";\nmissingThing();\n');
  fs.writeFileSync(path.join(project, 'index.html'), '<title>Offsite</title>\n<main>\n  <h1 class="hero">Offsite planner</h1>\n</main>\n<script src="app.js"></script>\n');
  await start();
  const code = shell().getByRole('region', { name: 'Code' });
  await code.getByRole('button', { name: 'Preview' }).click();
  await expect(shell().getByRole('region', { name: 'Right pane: Browser' })).toBeVisible();
  await expect(code.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
  const url = await shell().evaluate(async () => { const got = await window.mobius.code!.preview!('offsite-planner'); return 'url' in got ? got.url : ''; });
  // The page, as any browser shows it: its error comes to Code, and Go to it opens the line.
  const page = await shell().context().newPage();
  await page.goto(url);
  const note = code.getByRole('alert').filter({ hasText: 'The page has an error' });
  await expect(note).toContainText('missingThing');
  await expect(note).toContainText('app.js:2');
  await note.getByRole('button', { name: 'Go to it' }).click();
  await expect(shell().getByRole('textbox', { name: 'Contents of app.js' })).toBeVisible();
  await expect(code.locator('footer.code-status')).toContainText('Ln 2, Col 1');
  // Saving reloads the page.
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await shell().keyboard.press('Control+End');
  await shell().keyboard.type('// later');
  await shell().keyboard.press('Control+s');
  await expect.poll(() => loads).toBeGreaterThan(0);
  // Pick: the person clicks the heading on the page, and Go to code opens it where it is written.
  await code.getByRole('button', { name: 'Pick' }).click();
  await expect(code.getByRole('button', { name: 'Pick' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('h1').click();
  const picked = code.getByRole('status').filter({ hasText: 'Picked' });
  await expect(picked).toContainText('<h1> “Offsite planner” on index.html');
  await picked.getByRole('button', { name: 'Go to code' }).click();
  await expect(shell().getByRole('textbox', { name: 'Contents of index.html' })).toBeVisible();
  await expect(code.locator('footer.code-status')).toContainText('Ln 3, Col 3');
  await page.close();
});

test('the editor splits: the same file shows in both, another file opens beside with its own save, and Ctrl+\\ closes it', async () => {
  await start();
  const code = shell().getByRole('region', { name: 'Code' });
  const main = shell().getByRole('textbox', { name: 'Contents of src/budget.js' });
  await expect(main).toHaveValue(BUDGET);
  await code.getByRole('button', { name: 'Split' }).click();
  const side = shell().getByRole('region', { name: 'Second editor: src/budget.js' });
  await expect(side).toBeVisible();
  await expect(main).toHaveCount(2);
  // The same file: typing in the second shows in the first.
  await shell().keyboard.press('Control+End');
  await shell().keyboard.type('// both');
  await expect(main.first()).toHaveValue(`${BUDGET}// both`);
  await shell().keyboard.press('Control+z');
  await expect(main.first()).toHaveValue(BUDGET);
  // Ctrl+P in the second editor opens a file there; the first keeps its own.
  await shell().keyboard.press('Control+p');
  await shell().getByRole('combobox', { name: 'File to open' }).fill('budget.test');
  await shell().keyboard.press('Enter');
  const other = shell().getByRole('region', { name: 'Second editor: tests/budget.test.js' });
  const otherText = other.getByRole('textbox', { name: 'Contents of tests/budget.test.js' });
  await expect(otherText).toHaveValue(TEST);
  await expect(main).toHaveCount(1);
  await otherText.focus();
  await shell().keyboard.press('Control+Home');
  await shell().keyboard.type('// checked\n');
  await expect(other.getByRole('status').filter({ hasText: 'Not saved' })).toBeVisible();
  await expect(code.locator('.code-pane-main').getByText('Not saved')).toHaveCount(0);
  await shell().keyboard.press('Control+s');
  await expect.poll(() => fs.readFileSync(path.join(project, 'tests', 'budget.test.js'), 'utf8')).toBe(`// checked\n${TEST}`);
  expect(budget()).toBe(BUDGET);
  // Ctrl+\ closes the split, and opens it again on the file the first editor shows.
  await shell().keyboard.press('Control+Backslash');
  await expect(other).toBeHidden();
  await shell().keyboard.press('Control+Backslash');
  await expect(shell().getByRole('region', { name: 'Second editor: src/budget.js' })).toBeVisible();
});
