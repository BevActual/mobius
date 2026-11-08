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
test.afterEach(async () => {
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
  const bar = shell().getByRole('region', { name: 'Git' });
  await expect(bar).toContainText('⎇ main');
  await expect(bar.getByRole('status')).toHaveText('3 changes');
  await bar.getByRole('button', { name: 'Commit…' }).click();
  await bar.getByRole('textbox', { name: 'Commit message' }).fill('Start the offsite planner');
  await bar.getByRole('button', { name: 'Commit' }).click();
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
  await shell().getByRole('tab', { name: 'Console' }).click();
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
  await shell().getByRole('tab', { name: 'Console' }).click();
  const console_ = shell().getByRole('region', { name: 'Console' });
  await console_.getByRole('checkbox', { name: 'Keep running' }).check();
  await console_.getByRole('textbox', { name: 'Command' }).fill('node -e "setInterval(() => console.log(\'tick\'), 200)"');
  await console_.getByRole('button', { name: 'Start' }).click();
  const running = console_.getByRole('list', { name: 'Running' });
  await expect(running.getByRole('listitem').first()).toContainText('tick');
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
});
