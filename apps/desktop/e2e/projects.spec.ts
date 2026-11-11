import { expect, test, type Locator } from '@playwright/test';
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
  // Enter opens the row that is chosen: wait until that is Projects, as a person sees it before pressing.
  await expect(shell().getByRole('option', { name: /^Projects/, selected: true })).toBeVisible();
  await shell().keyboard.press('Enter');
  // Twice on CI (never here) the Projects page was not there after this. Say what the window showed instead, so the
  // cause can be seen rather than a test that times out on a closed page.
  // In a split with the conversation focused, the app chosen opens in the other pane and the conversation stays.
  try {
    await expect(shell().locator('.app[data-app="projects"]').or(shell().getByRole('region', { name: /^(Left|Right) pane: Projects$/ }))).toBeVisible({ timeout: 5_000 });
  } catch {
    const seen = await shell().evaluate(() => ({
      app: document.querySelector('.app')?.getAttribute('data-app'),
      launcherOpen: Boolean(document.querySelector('dialog[open]')),
      query: (document.querySelector('dialog[open] input') as HTMLInputElement | null)?.value,
      focus: document.activeElement?.outerHTML.slice(0, 160),
      regions: [...document.querySelectorAll('section[aria-label], [role="region"][aria-label]')].map((e) => e.getAttribute('aria-label')).slice(0, 20),
    }));
    throw new Error(`Projects did not open: ${JSON.stringify(seen)}`);
  }
}
async function newProject(name: string): Promise<void> {
  await shell().getByRole('button', { name: 'New project' }).first().click();
  await shell().getByRole('textbox', { name: 'Project name' }).fill(name);
  await shell().getByRole('textbox', { name: 'Project name' }).press('Enter');
  await expect(shell().getByRole('region', { name })).toBeVisible();
}
/** The project's newest thread is the conversation open. */
async function inThread(): Promise<void> {
  await expect.poll(async () => {
    const threads: string[] = fs.existsSync(path.join(userData, 'projects.json')) ? JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8'))[0]?.threads ?? [] : [];
    const open = await shell().evaluate(() => window.localStorage.getItem('mobius.conversation'));
    return threads.length > 0 && threads.at(-1) === open;
  }).toBe(true);
}
async function say(text: string): Promise<void> {
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill(text);
  await composer.press('Enter');
}

async function openRules(page: Locator): Promise<void> {
  const change = page.getByRole('region', { name: 'Rules for this project' }).getByRole('button', { name: 'Change' });
  if (await change.getAttribute('aria-expanded') !== 'true') await change.click();
}

test('a project is a place: its rules, its memory page in the Wiki, its threads and its files', async () => {
  await start();
  await openProjects();
  await newProject('Kestrel');
  const page = shell().getByRole('region', { name: 'Kestrel' });
  // The rules sit folded in one line until asked for; the threads and what they made come first.
  await expect(page.getByRole('region', { name: 'Rules for this project' })).toContainText('As in Settings');
  await openRules(page);
  await expect(page.getByRole('region', { name: 'Rules for this project' })).toContainText('Paying, sending, deleting and commands always ask.');
  await page.getByRole('combobox', { name: 'Docs in Kestrel' }).selectOption('act');
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8'))[0].rules).toEqual({ docs: 'act' });
  expect(fs.existsSync(path.join(userData, 'workspace', 'projects', 'Kestrel'))).toBe(true);
  expect(fs.existsSync(path.join(userData, 'workspace', 'wiki', 'Projects', 'Kestrel.md'))).toBe(true);
  await page.getByRole('button', { name: 'Open in Knowledge' }).click();
  await expect(shell().getByRole('textbox', { name: 'Document text' })).toBeVisible();
  await openProjects();
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('button', { name: "Open the project's folder" }).click();
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
  await openRules(page);
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
  await openRules(shell().getByRole('region', { name: 'Kestrel' }));
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

test('what Mobius learns in a project thread waits dashed on the project memory, Keep adds it, Discard drops it', async () => {
  await start([
    callsTool('memory-remember', { text: 'Builds start on Mondays', category: 'work', source: 'a conversation' }), says(['Noted for the project.']),
    callsTool('memory-remember', { text: 'The venue is in Lisbon', category: 'work', source: 'a conversation' }), says(['Noted that too.']),
  ]);
  await openProjects();
  await newProject('Kestrel');
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('button', { name: 'New thread' }).click();
  await inThread();
  for (const [ask, reply] of [['remember that builds start on Mondays', 'Noted for the project.'], ['and that the venue is in Lisbon', 'Noted that too.']] as const) {
    await say(ask);
    const card = log().getByRole('group', { name: 'Approval needed: memory.remember' });
    // In Ask first (as these tests start), remembering is asked about each time.
    await card.getByRole('button', { name: 'Allow once' }).click();
    await expect(log().locator('.msg.assistant').last()).toHaveText(reply);
  }
  // Not personal memory: it is the project's.
  expect(fs.existsSync(path.join(userData, 'memory.md')) ? fs.readFileSync(path.join(userData, 'memory.md'), 'utf8') : '').not.toContain('Mondays');
  await openProjects();
  const memory = shell().getByRole('region', { name: 'Kestrel' }).getByRole('region', { name: 'Project memory' });
  const mondays = memory.getByRole('listitem', { name: 'Builds start on Mondays, proposed by Mobius' });
  await expect(mondays).toHaveAttribute('data-proposed');
  await mondays.getByRole('button', { name: 'Keep' }).click();
  await expect(memory.getByRole('listitem', { name: 'Builds start on Mondays, proposed by Mobius' })).toHaveCount(0);
  await expect(memory.getByRole('list', { name: 'What this project knows' })).toContainText('Builds start on Mondays');
  await expect.poll(() => fs.readFileSync(path.join(userData, 'workspace', 'wiki', 'Projects', 'Kestrel.md'), 'utf8')).toContain('- Builds start on Mondays');
  await memory.getByRole('listitem', { name: 'The venue is in Lisbon, proposed by Mobius' }).getByRole('button', { name: 'Discard' }).click();
  await expect(memory.getByRole('listitem', { name: /Lisbon/ })).toHaveCount(0);
  expect(fs.readFileSync(path.join(userData, 'workspace', 'wiki', 'Projects', 'Kestrel.md'), 'utf8')).not.toContain('Lisbon');
});

test('a conversation started outside can be moved into a project, and from then on the project’s rules count in it', async () => {
  const change = callsTool('files-write', { path: 'docs/Plan.md', content: '# Plan\n' });
  await start([says(['Hello.']), change, says(['Wrote it in the project.'])]);
  await say('hello');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Hello.');
  await openProjects();
  await newProject('Kestrel');
  const page = shell().getByRole('region', { name: 'Kestrel' });
  await openRules(page);
  await page.getByRole('combobox', { name: 'Docs in Kestrel' }).selectOption('act');
  const move = page.getByRole('combobox', { name: 'Move a conversation into Kestrel' });
  await move.selectOption({ label: 'hello' });
  await expect(page.getByRole('list', { name: 'Threads' }).getByRole('button')).toHaveText([/hello/]);
  await expect(move).toHaveCount(0);
  await page.getByRole('list', { name: 'Threads' }).getByRole('button').click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Hello.');
  await say('write the plan');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Wrote it in the project.');
  await expect(log().getByRole('group', { name: /Approval needed/ })).toHaveCount(0);
});

test('a project can be renamed, and its folder and its memory page follow the name', async () => {
  await start();
  await openProjects();
  await newProject('Kestrel');
  const workspace = (...p: string[]) => path.join(userData, 'workspace', ...p);
  fs.writeFileSync(workspace('wiki', 'Projects', 'Kestrel.md'), '# Kestrel\n\n- Builds start on Mondays\n');
  fs.writeFileSync(workspace('projects', 'Kestrel', 'brief.md'), 'brief');
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('button', { name: 'Rename' }).click();
  const field = shell().getByRole('region', { name: 'Kestrel' }).getByRole('textbox', { name: 'Project name' });
  await field.fill('Kestrel P3');
  await field.press('Enter');
  const page = shell().getByRole('region', { name: 'Kestrel P3' });
  await expect(page.getByRole('heading', { name: 'Kestrel P3' })).toBeVisible();
  await expect(shell().getByRole('navigation', { name: 'Projects' }).getByRole('button')).toHaveText(['Kestrel P3']);
  expect(fs.readFileSync(workspace('projects', 'Kestrel P3', 'brief.md'), 'utf8')).toBe('brief');
  expect(fs.existsSync(workspace('projects', 'Kestrel'))).toBe(false);
  expect(fs.readFileSync(workspace('wiki', 'Projects', 'Kestrel P3.md'), 'utf8')).toContain('Builds start on Mondays');
  await expect(page.getByRole('list', { name: 'What this project knows' })).toContainText('Builds start on Mondays');
});

test('a bot asked from a project thread works in a side thread of its own and reports back into the thread', async () => {
  await start([says(['Hi.']), says(['Three venues: Casa A, Quinta B and Palácio C.'])]);
  await shell().evaluate(() => (window as unknown as { mobius: { bots: { create(d: { name: string; instructions: string; model: string }): Promise<unknown> } } }).mobius.bots.create({ name: 'Research', instructions: 'Find things out.', model: '' }));
  await openProjects();
  await newProject('Kestrel');
  await shell().getByRole('region', { name: 'Kestrel' }).getByRole('button', { name: 'New thread' }).click();
  await inThread();
  await say('hi');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Hi.');
  const sides = shell().getByRole('region', { name: 'Side threads' }).first();
  await sides.getByRole('combobox', { name: 'Agent' }).selectOption({ label: 'Research' });
  await sides.getByRole('textbox', { name: 'Ask an agent' }).fill('Find three venues in Lisbon');
  await sides.getByRole('textbox', { name: 'Ask an agent' }).press('Enter');
  const report = sides.getByRole('group', { name: 'From Research' });
  await expect(report).toContainText('From Research · “Find three venues in Lisbon”');
  await expect(report).toContainText('Three venues: Casa A, Quinta B and Palácio C.');
  // The side thread is the project's too, under the thread it was asked from.
  const project = JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8'))[0];
  expect(project.sides).toHaveLength(1);
  expect(project.sides[0].parent).toBe(project.threads[0]);
  await openProjects();
  await expect(shell().getByRole('region', { name: 'Kestrel' }).getByRole('list', { name: 'Threads' })).toContainText('ResearchReported back · Find three venues in Lisbon');
});
