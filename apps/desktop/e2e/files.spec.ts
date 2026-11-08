import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coreCall, launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-files-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

async function start(replies: ModelReply[]): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const card = (): Locator => shell().getByRole('group', { name: /Approval needed/ });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};
const file = (name: string) => path.join(userData, 'workspace', name);

test('writing a file asks first, then puts a real file in the workspace folder', async () => {
  await start([callsTool('files-write', { path: 'notes/todo.md', content: '- buy milk\n' }), says(['Saved.'])]);
  await say('save a todo');
  await expect(card()).toBeVisible();
  await expect(card()).toContainText('notes/todo.md');
  expect(fs.existsSync(file('notes/todo.md'))).toBe(false);
  await card().getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Saved.');
  expect(fs.readFileSync(file('notes/todo.md'), 'utf8')).toBe('- buy milk\n');
});

test('declining a write leaves nothing behind', async () => {
  await start([callsTool('files-write', { path: 'a.md', content: 'x' }), says(['Okay.'])]);
  await say('write');
  await expect(card()).toBeVisible();
  await card().getByRole('button', { name: 'Decline' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Okay.');
  expect(fs.existsSync(file('a.md'))).toBe(false);
});

test('edit changes one place, a checkpoint is kept, and a path outside the workspace is refused', async () => {
  await start([
    callsTool('files-write', { path: 'a.md', content: 'one two' }), says(['Wrote.']),
    callsTool('files-edit', { path: 'a.md', old: 'two', new: '2' }), says(['Edited.']),
    callsTool('files-write', { path: '../escape.txt', content: 'no' }), says(['Tried.']),
  ]);
  await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'off' }));
  await expect.poll(async () => (await coreCall<{ mode: string }>(mobius!.app, 'permissions.mode', {})).mode).toBe('off');
  await say('write'); await expect(log().locator('.msg.assistant').last()).toHaveText('Wrote.');
  await say('edit'); await expect(log().locator('.msg.assistant').last()).toHaveText('Edited.');
  expect(fs.readFileSync(file('a.md'), 'utf8')).toBe('one 2');
  await say('escape'); await expect(log().locator('.msg.assistant').last()).toHaveText('Tried.');
  expect(fs.existsSync(path.join(userData, 'escape.txt'))).toBe(false);
  expect(fs.existsSync(path.join(userData, 'workspace', '..', 'escape.txt'))).toBe(false);
  // Before the edit, the file was checkpointed.
  expect(fs.existsSync(path.join(userData, 'checkpoints', 'HEAD'))).toBe(true);
});
