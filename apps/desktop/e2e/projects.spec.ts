import { expect, test } from '@playwright/test';
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-projects-'));
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
const log = () => shell().getByRole('log', { name: 'Conversation' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
}
async function openProjects(): Promise<void> {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Projects');
  await shell().keyboard.press('Enter');
}
async function newProject(name: string): Promise<void> {
  await shell().getByRole('button', { name: 'New project' }).first().click();
  await shell().getByRole('textbox', { name: 'Project name' }).fill(name);
  await shell().getByRole('textbox', { name: 'Project name' }).press('Enter');
  await expect(shell().getByRole('region', { name })).toBeVisible();
}
async function say(text: string): Promise<void> {
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill(text);
  await composer.press('Enter');
}

test('a project is a place: its rules, its memory page in the Wiki, its threads and its files', async () => {
  await start();
  await openProjects();
  await newProject('Kestrel');
  const page = shell().getByRole('region', { name: 'Kestrel' });
  await expect(page.getByRole('region', { name: 'Rules for this project' })).toContainText('Paying, sending, deleting and commands always ask.');
  await page.getByRole('combobox', { name: 'Docs in Kestrel' }).selectOption('act');
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8'))[0].rules).toEqual({ docs: 'act' });
  expect(fs.existsSync(path.join(userData, 'workspace', 'projects', 'Kestrel'))).toBe(true);
  expect(fs.existsSync(path.join(userData, 'workspace', 'wiki', 'Projects', 'Kestrel.md'))).toBe(true);
  await page.getByRole('button', { name: 'Open in Wiki' }).click();
  await expect(shell().getByRole('textbox', { name: 'Document text' })).toBeVisible();
  await openProjects();
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('button', { name: 'Open in Files' }).click();
  await expect(shell().getByRole('region', { name: 'Files' }).getByRole('navigation', { name: 'Folder' })).toHaveText('Workspace › projects › Kestrel');
  await openProjects();
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('button', { name: 'New thread' }).click();
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeVisible();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8'))[0].threads.length).toBe(1);
});

test('the core counts a project’s rules in its threads only: Act goes ahead there, Ask first asks every time', async () => {
  const change = callsTool('files-write', { path: 'docs/Plan.md', content: '# Plan\n' });
  await start([
    change, says(['Not written outside.']),
    change, says(['Wrote it in the project.']),
    callsTool('browser-open', { url: fixture.origin + '/second' }), says(['Opened it in the project.']),
    change, says(['Wrote it again.']),
  ]);
  // Outside any project, the usual settings: the change asks.
  await say('write the plan');
  const outside = log().getByRole('group', { name: 'Approval needed: files.write' });
  await expect(outside.getByRole('button', { name: 'Always allow' })).toBeVisible();
  await outside.getByRole('button', { name: 'Decline' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Not written outside.');

  await openProjects();
  await newProject('Kestrel');
  const page = shell().getByRole('region', { name: 'Kestrel' });
  await page.getByRole('combobox', { name: 'Docs in Kestrel' }).selectOption('act');
  await page.getByRole('combobox', { name: 'Browser in Kestrel' }).selectOption('act');
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8'))[0].rules).toEqual({ browser: 'act', docs: 'act' });
  await page.getByRole('button', { name: 'New thread' }).click();
  await expect(log().getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
  // In the project, Act: the same change, and opening a page, go ahead without asking.
  await say('write the plan here');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Wrote it in the project.');
  await say('open the second page');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Opened it in the project.');
  await expect(log().getByRole('group', { name: /Approval needed/ })).toHaveCount(0);
  expect(fixture.hits).toContain('/second');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'docs', 'Plan.md'), 'utf8')).toBe('# Plan\n');

  // Ask first in the project: the person, every time, and only Allow once answers.
  await openProjects();
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('combobox', { name: 'Docs in Kestrel' }).selectOption('ask');
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('navigation', { name: 'Threads' }).or(shell().getByRole('region', { name: 'Kestrel' }).getByRole('list', { name: 'Threads' })).getByRole('button').first().click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Opened it in the project.');
  await say('write it again');
  const card = log().getByRole('group', { name: 'Approval needed: files.write' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Always allow' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Wrote it again.');
});
