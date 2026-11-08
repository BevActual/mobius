import { expect, test, type Locator } from '@playwright/test';
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
