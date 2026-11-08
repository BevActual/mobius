import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture } from './model-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'The plan and questions are built in the Tauri shell');

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-plan-'));
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
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });

async function start(replies: Parameters<typeof startModel>[0]): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}
const say = async (text: string) => {
  await composer().fill(text);
  await composer().press('Enter');
};

test('the assistant keeps a plan you can follow, without asking permission for it', async () => {
  await start([
    callsTool('todo-write', { items: [{ text: 'Read the notes', status: 'done' }, { text: 'Write the summary', status: 'in_progress' }, { text: 'Check it', status: 'pending' }] }),
    says(['Summary written.']),
  ]);
  await say('summarise my notes');
  const plan = log().getByRole('region', { name: 'Plan' });
  await expect(plan).toContainText('1 of 3 done');
  await expect(plan.getByRole('listitem', { name: 'Write the summary: Working on it' })).toBeVisible();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Summary written.');
  // No approval card and no tool step for keeping a plan.
  await expect(log().getByRole('group', { name: /Approval needed/ })).toHaveCount(0);
  await expect(log()).not.toContainText('todo.write');
});

test('the assistant can ask you something, waits, and goes on with your answer', async () => {
  await start([callsTool('ask-person', { question: 'Which file should I tidy?', choices: ['notes.md', 'todo.md'] }), says(['Tidied todo.md.'])]);
  await say('tidy a file');
  const card = log().getByRole('group', { name: 'Mobius asks' });
  await expect(card).toContainText('Which file should I tidy?');
  await expect(shell().getByRole('status', { name: 'Mobius is working' })).toHaveCount(0);
  await card.getByRole('button', { name: 'todo.md' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Tidied todo.md.');
  await expect(card).toContainText('You answered: todo.md');
  const sent = JSON.stringify(model!.requests[1]!.messages);
  expect(sent).toContain('The person answered: todo.md');
});

test('a question can be answered in your own words, and is still there when the window reloads', async () => {
  await start([callsTool('ask-person', { question: 'What should the title be?' }), says(['Done.'])]);
  await say('make a page');
  await expect(log().getByRole('group', { name: 'Mobius asks' })).toBeVisible();
  await shell().reload();
  const card = log().getByRole('group', { name: 'Mobius asks' });
  await expect(card).toContainText('What should the title be?', { timeout: 15_000 });
  await card.getByRole('textbox', { name: 'Your answer' }).fill('Garden plans');
  await card.getByRole('button', { name: 'Answer' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Done.');
  expect(JSON.stringify(model!.requests[1]!.messages)).toContain('The person answered: Garden plans');
});
