import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, turnEnded } from './harness';
import { startMailServers } from './mail-fixture';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-surface-'));
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
const suggestions = (): Locator => shell().getByRole('group', { name: 'Suggestions' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}
const openApp = async (name: string) => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
  await shell().keyboard.press('Enter');
};
/** The desk's large title. */
const GREETING = /^Good (morning|afternoon|evening)$/;
const sent = () => JSON.stringify(model!.requests.at(-1)?.messages ?? []);

test('an empty Agent app is the desk: one greeting, suggestions under it, which are sent as is', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await start([says(['Here is an overview.'])]);
  await openApp('Agent');
  const region = shell().getByRole('region', { name: 'Agent conversation' });
  await expect(region.getByRole('heading', { name: GREETING })).toBeVisible();
  await expect(region.getByRole('heading', { name: 'What can I help with?' })).toHaveCount(0);
  // The desk shows what is open in your apps, each row one press from its app.
  await expect(region.getByRole('region', { name: 'Desk' }).getByRole('button', { name: /Browser.*1 tab open/ })).toBeVisible();
  await region.getByRole('group', { name: 'Suggestions' }).getByRole('button', { name: 'Catch me up' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Here is an overview.');
  expect(sent()).toContain('give me a short overview');
  // A conversation has started, so the desk has gone; the suggestions hide while you type.
  await expect(region.getByRole('heading', { name: GREETING })).toHaveCount(0);
  await turnEnded(composer());
  await composer().fill('x');
  await expect(region.getByRole('group', { name: 'Suggestions' })).toHaveCount(0);
});

test('on first run, once a model answers, the desk offers mail and calendar first, each opening its accounts in Settings', async () => {
  await start([]);
  await openApp('Agent');
  const getStarted = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Get started' });
  await expect(getStarted.getByText('Connect your mail and calendar')).toBeVisible();
  await getStarted.getByRole('button', { name: 'Add mail' }).click();
  const page = shell().getByRole('region', { name: 'Settings' });
  await expect(page.getByText('Mail accounts', { exact: true }).first()).toBeVisible();
  await shell().keyboard.press('Escape');
  await getStarted.getByRole('button', { name: 'Add calendar' }).click();
  await expect(page.getByText('Calendar accounts', { exact: true }).first()).toBeVisible();
});

test('the desk is the Agent app’s home: what waits is allowed in place, and what is scheduled comes next', async () => {
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.'])]);
  await shell().evaluate(() => window.mobius.schedules?.add({ title: 'Morning brief', prompt: 'What is on today?', time: '08:00', days: [1, 2, 3, 4, 5, 6, 7], enabled: true }));
  // A conversation started beside the page waits for an approval.
  await composer().fill('make an ideas page');
  await composer().press('Enter');
  await expect(shell().getByRole('group', { name: /Approval needed/ })).toBeVisible();
  await openApp('Agent');
  await shell().locator('.app-side-new').click();
  const desk = shell().getByRole('region', { name: 'Agent conversation' }).getByRole('region', { name: 'Desk' });
  await expect(desk.getByRole('heading', { name: GREETING })).toBeVisible();
  await expect(desk.locator('.desk-title')).toContainText('1 waiting for you');
  // Chats are in the Chats panel; the desk's Inbox lists the one that waits, answered from its row.
  await expect(desk.getByRole('group', { name: 'Recent' })).toHaveCount(0);
  const inbox = desk.getByRole('group', { name: 'Inbox' });
  await expect(inbox.getByRole('listitem')).toContainText('Wants to');
  await expect(desk.getByRole('group', { name: 'Next' }).getByRole('button', { name: /Morning brief.*at 0?8:00/ })).toBeVisible();
  await inbox.getByRole('button', { name: /^Allow .* once$/ }).click();
  await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Ideas.md'))).toBe(true);
  // Once answered, nothing waits (Notes is open beside it, so its change is already in view).
  await expect(inbox).toHaveCount(0);
  // Once it has finished it is in the Chats panel, and one press picks it up again.
  await shell().getByRole('complementary', { name: 'Chats' }).locator('.clist-main').first().click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
});

test('Try another puts the change back and asks Mobius to do it another way', async () => {
  await start([callsTool('files-write', { path: 'notes/Work/Ideas.md', content: '# Ideas\n' }), says(['Made it.']), says(['Here is another way.'])]);
  await composer().fill('make an ideas page');
  await composer().press('Enter');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Made it.');
  const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
  // One bar, the same everywhere: Try another, Discard, Keep.
  // A card from the start: the count, Keep, each change as a link to it, then Try another and Discard.
  await expect(strip.getByRole('button', { name: /changes? in Notes ·? ?Review/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(strip.getByRole('button', { name: 'Discard' })).toBeVisible();
  await strip.getByRole('button', { name: 'Try another' }).click();
  await expect.poll(() => fs.existsSync(path.join(userData, 'workspace', 'notes', 'Work', 'Ideas.md'))).toBe(false);
  await expect(log().locator('.msg.assistant').last()).toHaveText('Here is another way.');
  expect(sent()).toContain('I discarded that change. Try another way: a clearly different approach');
});

test('a suggestion that starts a sentence puts it in the box for you to finish', async () => {
  await start();
  await openApp('Agent');
  await suggestions().getByRole('button', { name: 'Draft something' }).click();
  await expect(composer()).toHaveValue('Help me draft ');
  await expect(composer()).toBeFocused();
  expect(model!.requests).toHaveLength(0);
});

test('Find a time with… puts only those words in the box: who you name finishes them, and the steps go behind Details', async () => {
  await start([says(['Here are the times.'])]);
  await openApp('Calendar');
  await suggestions().getByRole('button', { name: 'Find a time with…' }).click();
  await expect(composer()).toHaveValue('Find a time with ');
  await composer().pressSequentially('Sam');
  await composer().press('Enter');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Here are the times.');
  await expect(log().locator('.msg.user').last()).toContainText('Find a time with Sam');
  // The steps are there, folded behind Details.
  await expect(log().locator('.msg.user').last().locator('.msg-steps p')).toBeHidden();
  await expect(log().locator('.msg.user').last().locator('.msg-steps p')).toContainText('calendar.free');
  expect(sent()).toContain('Then call calendar.free once');
  expect(sent()).toContain('I want to meet with Sam');
});

test('in the browser, a page suggestion attaches the page you see, as a chip', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await start([says(['A short summary.'])]);
  const address = shell().getByRole('textbox', { name: 'Address or question' });
  await address.fill(fixture.origin + '/article');
  await address.press('Enter');
  await expect(shell().locator('.tab-title').first()).toHaveText('Article');
  await suggestions().getByRole('button', { name: 'Summarise this page' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('A short summary.');
  await expect(log().getByRole('list', { name: 'Attached' })).toContainText('Article');
  expect(sent()).toContain('Summarise this page');
});

test('in Notes, a note suggestion attaches the open note', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Home'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Home', 'Errands.md'), '# Errands\nBuy stamps and call the plumber.\n');
  await start([says(['- [ ] Buy stamps']) ]);
  await openApp('Notes');
  const side = shell().getByRole('complementary', { name: 'Notebooks' });
  await side.getByRole('button', { name: 'Errands', exact: true }).click();
  await expect(shell().getByRole('textbox', { name: 'Note text' })).toContainText('Buy stamps');
  await suggestions().getByRole('button', { name: 'Make a to-do list' }).click();
  // The reply's to-do shows as an unticked box with its words.
  await expect(log().locator('.msg.assistant')).toHaveText('Buy stamps');
  await expect(log().locator('.msg.assistant').getByRole('checkbox', { name: 'Not done' })).not.toBeChecked();
  await expect(log().getByRole('list', { name: 'Attached' })).toContainText('Errands');
  expect(sent()).toContain('call the plumber');
});

test('a message sent in the background leaves the panel, and what it did lands in the Inbox with Keep all', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Work'), { recursive: true });
  await start([callsTool('files-write', { path: 'notes/Work/Brief.md', content: '# Brief\n' }), says(['I wrote the brief.'])]);
  await openApp('Notes');
  if (!(await composer().isVisible())) await shell().keyboard.press('Control+Shift+M');
  await composer().fill('Write a brief');
  await composer().press('Alt+Enter');
  // The panel steps aside while Mobius works; its pill says when it needs you, and opens the panel.
  await expect(composer()).toBeHidden();
  const pill = shell().locator('.working-pill');
  await expect(pill).toContainText('Mobius needs you');
  await expect(pill.getByRole('button').first()).toBeFocused();
  await pill.getByRole('button').first().click();
  await log().getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toContainText('I wrote the brief.');
  // Home, from a new chat: the finished work waits there with Keep all.
  await shell().getByRole('button', { name: 'All chats' }).click();
  await shell().getByRole('menu', { name: 'Conversations' }).getByRole('menuitem', { name: 'New chat' }).click();
  await openApp('Agent');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  await expect(inbox.getByRole('button', { name: 'Open Write a brief: Finished in the background · 1 change to keep' })).toBeVisible();
  await inbox.getByRole('button', { name: 'Keep all of Write a brief' }).click();
  await expect(inbox.getByRole('button', { name: /^Open Write a brief/ })).toHaveCount(0);
  await expect(shell().getByRole('region', { name: 'Desk' }).getByRole('status').first()).toHaveText('Kept everything from Write a brief');
  // Not some other button on the desk: with the Inbox empty, the message box.
  await expect(composer()).toBeFocused();
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Brief.md'), 'utf8')).toBe('# Brief\n');
});

test('work running in another chat is listed under this one, with Stop', async () => {
  // A slow answer, so the first chat is still working when the second one opens.
  await start([says(['Thinking it ', 'through…'], 4000)]);
  await openApp('Notes');
  if (!(await composer().isVisible())) await shell().keyboard.press('Control+Shift+M');
  await composer().fill('Write a long brief');
  await composer().press('Alt+Enter');
  await expect(shell().locator('.working-pill')).toBeVisible();
  await shell().locator('.working-pill-open').click();
  await shell().getByRole('button', { name: 'All chats' }).click();
  await shell().getByRole('menu', { name: 'Conversations' }).getByRole('menuitem', { name: 'New chat' }).click();
  const jobs = shell().getByRole('region', { name: 'Running jobs' });
  await expect(jobs).toContainText('Write a long brief');
  await expect(jobs).toContainText('In the background');
  await jobs.getByRole('button', { name: 'Stop Write a long brief' }).click();
  await expect(jobs).toHaveCount(0);
  // The row went with the focus on it: the message box takes it.
  await expect(composer()).toBeFocused();
});

test('Assign to Mobius on a task runs it in a chat of its own and lands in the Inbox, leaving the open chat alone', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Home.md'), '# Home\n\n- [ ] Fix the tap\n');
  await start([says(['I found three plumbers ', 'near you.'], 1500)]);
  await openApp('Tasks');
  await shell().getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Home/ }).click();
  await shell().locator('.tasks-page').getByRole('button', { name: 'Fix the tap', exact: true }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Assign to Mobius' }).click();
  await expect(shell().locator('.toast')).toHaveText('Assigned to Mobius. It will be in your Inbox when done.');
  // Assigned again while Mobius is on it: said, not started twice.
  await shell().locator('.tasks-page').getByRole('button', { name: 'Fix the tap', exact: true }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Assign to Mobius' }).click();
  await expect(shell().locator('.toast')).toHaveText('Mobius is already working on Fix the tap.');
  expect(model!.requests.length).toBe(1);
  // Choosing it moves nothing on the page: the keyboard is back on the task's row.
  await expect.poll(() => shell().evaluate(() => document.activeElement?.closest('li.task')?.textContent ?? '')).toContain('Fix the tap');
  // The ask names the task and its list, and starts in Tasks.
  await expect.poll(() => sent()).toContain('Work on this task from my Tasks list \\"Home\\": \\"Fix the tap\\"');
  // The open chat is not the one it runs in: it is listed under it while it runs.
  if (!(await composer().isVisible())) await shell().keyboard.press('Control+Shift+M');
  await expect(log().locator('.msg')).toHaveCount(0);
  const jobs = shell().getByRole('region', { name: 'Running jobs' });
  await expect(jobs).toContainText('In the background');
  // Named after the task, not the words of the ask.
  await expect(jobs.getByRole('button', { name: 'Stop Fix the tap' })).toBeVisible();
  await openApp('Agent');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  await expect(inbox.getByRole('button', { name: 'Open Fix the tap: Finished in the background' })).toBeVisible();
  // Done clears it; with the Inbox empty, the message box takes the keyboard.
  await inbox.getByRole('button', { name: 'Done with Fix the tap' }).click();
  await expect(inbox.getByRole('button', { name: /^Open Fix the tap/ })).toHaveCount(0);
  await expect(composer()).toBeFocused();
});

test('a task can go to one of the person\'s own agents by name, which works on it with its own instructions', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Home.md'), '# Home\n\n- [ ] Fix the tap\n');
  await start([says(['Booked a plumber for Friday.'])]);
  const made = await shell().evaluate(() => window.mobius.bots.create({ name: 'Handy', instructions: 'Find local tradespeople and book them.', model: '' }));
  expect(made.ok).toBe(true);
  await openApp('Tasks');
  await shell().getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Home/ }).click();
  await shell().locator('.tasks-page').getByRole('button', { name: 'Fix the tap', exact: true }).click({ button: 'right' });
  // Mobius first, then the person's agents by name.
  await expect(shell().getByRole('menuitem', { name: /^Assign to / })).toHaveText(['Assign to Mobius', 'Assign to Handy']);
  await shell().getByRole('menuitem', { name: 'Assign to Handy' }).click();
  await expect(shell().locator('.toast')).toHaveText('Assigned to Handy. It will be in your Inbox when done.');
  await expect.poll(() => model!.requests.length).toBe(1);
  // It runs as that agent: its instructions are in the ask, along with the task.
  const asked = JSON.stringify(model!.requests[0]!);
  expect(asked).toContain('Find local tradespeople and book them.');
  expect(asked).toContain('Fix the tap');
  await openApp('Agent');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  // Its row says which agent did it, and opening it shows a box that names that agent.
  await expect(inbox.getByRole('button', { name: 'Open Fix the tap: Handy finished in the background' })).toBeVisible({ timeout: 15_000 });
  await inbox.getByRole('button', { name: 'Open Fix the tap: Handy finished in the background' }).click();
  await expect(composer()).toHaveAttribute('placeholder', 'Message Handy');
});

test('a job that took several steps offers Save as Ability in the Inbox, which writes one from its steps to Keep', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Home.md'), '# Home\n\n- [ ] Fix the tap\n');
  const skill = '---\nname: find-a-tradesperson\ndescription: When something at home needs fixing\n---\n\n1. Read the task.\n2. Look for local tradespeople.\n3. Say who to call.\n';
  await start([
    callsTool('tasks-list'), callsTool('notes-search', { query: 'plumber' }), callsTool('files-list', { path: 'notes' }), says(['Call the plumber on Friday.']),
    callsTool('skills-list'), callsTool('files-write', { path: 'skills/find-a-tradesperson/SKILL.md', content: skill }), says(['Saved it as find-a-tradesperson.']),
  ]);
  await shell().evaluate(() => window.mobius.preferences.set({ approvalMode: 'propose' }));
  await openApp('Tasks');
  await shell().getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Home/ }).click();
  await shell().locator('.tasks-page').getByRole('button', { name: 'Fix the tap', exact: true }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Assign to Mobius' }).click();
  await openApp('Agent');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  // Pressed twice at once: one Ability, not two.
  await inbox.getByRole('button', { name: 'Save Fix the tap as an Ability' }).dblclick({ timeout: 15_000 });
  await expect(shell().locator('.toast')).toHaveText('Mobius is writing it as an Ability. It will be in your Inbox to keep.');
  // It is asked from the job's own steps, with only the Abilities' and files' tools, and not to do the job again.
  await expect.poll(() => model!.requests.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
  const asked = JSON.stringify(model!.requests[4]!);
  expect(asked).toContain('Save \\"Fix the tap\\" as an Ability');
  expect(asked).toContain('notes.search (query: plumber)');
  expect(asked).toContain('Do not do the job again');
  expect(asked).not.toContain('"tasks-add"');
  // The new Ability waits in the Inbox to keep; the job's own row no longer offers it.
  await expect(inbox.getByRole('button', { name: 'Open Ability from Fix the tap: Finished in the background · 1 change to keep' })).toBeVisible({ timeout: 15_000 });
  await expect(inbox.getByRole('button', { name: 'Save Fix the tap as an Ability' })).toHaveCount(0);
  await expect(inbox.getByRole('button', { name: /^Save Ability from/ })).toHaveCount(0);
  await inbox.getByRole('button', { name: 'Keep all of Ability from Fix the tap' }).click();
  expect(fs.readFileSync(path.join(userData, 'workspace', 'skills', 'find-a-tradesperson', 'SKILL.md'), 'utf8')).toBe(skill);
  // Once kept, the job it came from still does not offer it again, and only one Ability was asked for.
  await expect(inbox.getByRole('button', { name: /^Open Fix the tap/ })).toBeVisible();
  await expect(inbox.getByRole('button', { name: 'Save Fix the tap as an Ability' })).toHaveCount(0);
  expect(model!.requests.filter((r) => JSON.stringify(r).includes('as an Ability')).length).toBeLessThanOrEqual(3);
  expect(model!.requests.length).toBe(7);
});

test('Assign to Mobius on a note, from its row in Notebooks, asks about that note and lands in the Inbox', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Work'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Offsite.md'), '# Offsite\n\n- Find a venue\n');
  await start([says(['I listed three venues.'])]);
  await openApp('Notes');
  const row = shell().getByRole('complementary', { name: 'Notebooks' }).getByRole('button', { name: 'Offsite', exact: true });
  await row.click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Assign to Mobius' }).click();
  await expect(shell().locator('.toast')).toHaveText('Assigned to Mobius. It will be in your Inbox when done.');
  await expect(row).toBeFocused();
  await expect.poll(() => sent()).toContain('Work on my note in Notes \\"Offsite\\" (notes/Work/Offsite.md)');
  await openApp('Agent');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  await expect(inbox.getByRole('button', { name: 'Open Offsite: Finished in the background' })).toBeVisible();
});

test('a run assigned to Mobius and stopped says so in the Inbox, not that it finished', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Home.md'), '# Home\n\n- [ ] Book the train\n');
  await start([says(['Looking at ', 'times…'], 6000)]);
  await openApp('Tasks');
  await shell().getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Home/ }).click();
  await shell().locator('.tasks-page').getByRole('button', { name: 'Book the train', exact: true }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Assign to Mobius' }).click();
  if (!(await composer().isVisible())) await shell().keyboard.press('Control+Shift+M');
  await shell().getByRole('region', { name: 'Running jobs' }).getByRole('button', { name: 'Stop Book the train' }).click();
  await openApp('Agent');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  await expect(inbox.getByRole('button', { name: 'Open Book the train: Stopped before it finished' })).toBeVisible();
  // Open goes to that chat, with the keyboard in its message box.
  await inbox.getByRole('button', { name: 'Open Book the train: Stopped before it finished' }).click();
  await expect(composer()).toBeFocused();
});

test('a chat opened while it runs in the background shows it running, with Stop, and its pill once the panel closes', async () => {
  // Long enough before its first word that only the chat list can say it is running.
  await start([says(['Here it ', 'is.'], 8000)]);
  await openApp('Notes');
  if (!(await composer().isVisible())) await shell().keyboard.press('Control+Shift+M');
  await composer().fill('Write a long brief');
  await composer().press('Alt+Enter');
  await shell().locator('.working-pill-open').click();
  await shell().getByRole('button', { name: 'All chats' }).click();
  await shell().getByRole('menu', { name: 'Conversations' }).getByRole('menuitem', { name: 'New chat' }).click();
  await shell().getByRole('region', { name: 'Running jobs' }).getByRole('button', { name: /Write a long brief/ }).first().click();
  await expect(log().locator('.msg.user')).toContainText('Write a long brief');
  await expect(shell().getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await shell().keyboard.press('Control+Shift+M');
  const pill = shell().locator('.working-pill');
  await expect(pill).toBeVisible();
  await pill.getByRole('button', { name: 'Stop Mobius' }).click();
  await expect(pill).toHaveCount(0);
});

test('Stop in the panel leaves the keyboard in the message box', async () => {
  await start([says(['Thinking it ', 'through…'], 6000)]);
  await openApp('Notes');
  if (!(await composer().isVisible())) await shell().keyboard.press('Control+Shift+M');
  await composer().fill('Write a long brief');
  await composer().press('Enter');
  await shell().getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(shell().getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await expect(composer()).toBeFocused();
});

test('Ask from anywhere: Ctrl+Shift+J on words in a note asks about them in a card by them, without opening the panel', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Work'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Trip.md'), '# Trip\n\nThe ferry leaves Piraeus at dawn.\n');
  await start([says(['Piraeus is ', 'the port of Athens.'], 300), says(['## City\n\n**Athens**.'], 100), says(['Yes, at dawn.'], 100)]);
  await openApp('Notes');
  if (await composer().isVisible()) await shell().keyboard.press('Control+Shift+M');
  await shell().getByRole('button', { name: 'Trip', exact: true }).click();
  const note = shell().getByRole('textbox', { name: 'Note text' });
  await expect(note).toContainText('Piraeus');
  await note.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent?.indexOf('Piraeus') ?? -1;
      if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 'Piraeus'.length); const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r); break; }
    }
  });
  await shell().keyboard.press('Control+Shift+J');
  const card = shell().getByRole('dialog', { name: 'Ask Mobius about the selection' });
  await expect(card).toContainText('Piraeus');
  const field = card.getByRole('textbox', { name: 'Ask about the selection' });
  await expect(field).toBeFocused();
  await field.fill('Where is this?');
  await field.press('Enter');
  await expect(card.getByRole('status', { name: "Mobius's answer" })).toContainText('Piraeus is the port of Athens.');
  // Asked in Ask mode, with the chosen words and the note they are in.
  expect(model!.requests.at(-1)?.messages ? sent() : '').toContain('Selected text: \\"Piraeus\\"');
  await expect(composer()).toBeHidden();
  // Esc puts the keyboard back in the note.
  await field.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(note).toBeFocused();
  // Esc closes it from the note too, though the note keeps Escape for itself.
  await shell().keyboard.press('Control+Shift+J');
  await expect(card).toBeVisible();
  await note.focus();
  await shell().keyboard.press('Escape');
  await expect(card).toHaveCount(0);  // Replace selection: the answer goes in place of the chosen words, saved as the person's own typing.
  await shell().keyboard.press('Control+Shift+J');
  await card.getByRole('textbox', { name: 'Ask about the selection' }).fill('Name the city');
  await card.getByRole('textbox', { name: 'Ask about the selection' }).press('Enter');
  await card.getByRole('button', { name: 'Replace selection' }).click();
  await expect(card).toHaveCount(0);
  // Inside one line: one line, without the answer's heading or a second full stop.
  await expect(note).toContainText('The ferry leaves Athens at dawn.');
  await expect.poll(() => fs.readFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Trip.md'), 'utf8')).toContain('The ferry leaves Athens at dawn.');
  // Asked in the note's own chat: the panel beside it has the questions, and one asked while it is open shows there.
  await shell().keyboard.press('Control+Shift+M');
  await expect(log().locator('.msg.user').first()).toContainText('Where is this?');
  await note.focus();
  await note.evaluate((el) => {
    const p = [...el.querySelectorAll('p')].find((x) => x.textContent?.includes('ferry'))!;
    const r = document.createRange(); r.selectNodeContents(p); const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r);
  });
  await shell().keyboard.press('Control+Shift+J');
  await card.getByRole('textbox', { name: 'Ask about the selection' }).fill('Is it early?');
  await card.getByRole('textbox', { name: 'Ask about the selection' }).press('Enter');
  await expect(card.getByRole('status', { name: "Mobius's answer" })).toContainText('Yes');
  await expect(log().locator('.msg.user').last()).toContainText('Is it early?');
});

test('chats live on items: each note keeps its own chat, the list away from them is the general one', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Work'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Trip.md'), '# Trip\n\nFerry at dawn.\n');
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Work', 'Budget.md'), '# Budget\n\nTwo nights.\n');
  await start([says(['About the trip.']), says(['About the budget.'])]);
  await openApp('Notes');
  if (!(await composer().isVisible())) await shell().keyboard.press('Control+Shift+M');
  await shell().getByRole('button', { name: 'Trip', exact: true }).click();
  // The panel takes the note's chat once the person stays on it a moment; it is named after the note until asked.
  await expect(shell().getByRole('button', { name: 'Trip: all chats' })).toBeVisible();
  await composer().fill('When is the ferry?');
  await composer().press('Enter');
  await expect(log().locator('.msg.assistant')).toContainText('About the trip.');
  await shell().getByRole('button', { name: 'Budget', exact: true }).click();
  // Another note: its own chat, empty until asked.
  await expect(shell().getByRole('button', { name: 'Budget: all chats' })).toBeVisible();
  await expect(log().locator('.msg')).toHaveCount(0);
  await composer().fill('How many nights?');
  await composer().press('Enter');
  await expect(log().locator('.msg.assistant')).toContainText('About the budget.');
  // Back to the first: its chat comes back with it.
  await shell().getByRole('button', { name: 'Trip', exact: true }).click();
  await expect(log().locator('.msg.user')).toContainText('When is the ferry?');
  // All chats says what each is about.
  await shell().getByRole('button', { name: /all chats$/ }).click();
  const menu = shell().getByRole('menu', { name: 'Conversations' });
  await expect(menu.getByRole('menuitem', { name: /When is the ferry\?.*Trip/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /How many nights\?.*Budget/ })).toBeVisible();
});

test('a chat a schedule starts is listed as running while it runs', async () => {
  await start([says(['Looking ', 'through it…'], 4000)]);
  await openApp('Agent');
  const ran = await shell().evaluate(async () => {
    const made = await window.mobius.schedules!.add({ title: 'Morning brief', prompt: 'Brief me', time: '07:00', days: [1], enabled: false });
    return made.ok ? window.mobius.schedules!.runNow(made.schedule.id) : made;
  });
  expect(ran.ok).toBe(true);
  const jobs = shell().getByRole('region', { name: 'Running jobs' });
  await expect(jobs.locator('.running-job')).toHaveCount(1);
  await expect(jobs).toContainText('Working');
  await expect(shell().getByRole('status', { name: 'Running jobs status' })).toContainText('Also running');
});

test('the Inbox gathers tasks due and project updates due, each with Done and Later, as Linear’s', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Home.md'), '# Home\n\n- [ ] Pay rent (due 2001-01-01)\n- [ ] Call the plumber (due 2001-01-02)\n');
  fs.writeFileSync(path.join(userData, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'Offsite', rules: {}, threads: [], status: 'started' }]));
  await start();
  await openApp('Agent');
  const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
  await expect(inbox.getByRole('button', { name: 'Pay rent: Overdue · Home' })).toBeVisible();
  await expect(inbox.getByRole('button', { name: 'Offsite: No update yet' })).toBeVisible();
  // Done on a task ticks it off in Tasks.
  await inbox.getByRole('button', { name: 'Complete Pay rent' }).click();
  await expect.poll(() => fs.readFileSync(path.join(userData, 'workspace', 'tasks', 'Home.md'), 'utf8')).toContain('- [x] Pay rent');
  await expect(inbox.getByRole('button', { name: /^Pay rent/ })).toHaveCount(0);
  // Later sets an item aside; it folds under a link and can be brought back.
  await inbox.getByRole('button', { name: 'Later: Offsite' }).click();
  await shell().getByRole('menuitem', { name: 'Next week' }).click();
  await expect(inbox.getByRole('button', { name: 'Offsite: No update yet' })).toHaveCount(0);
  await inbox.getByRole('button', { name: '1 set aside for later' }).click();
  await inbox.getByRole('button', { name: 'Bring back Offsite' }).click();
  await expect(inbox.getByRole('button', { name: 'Offsite: No update yet' })).toBeVisible();
  // From the keyboard: H sets the focused item aside until tomorrow, and the row after it takes focus.
  await inbox.getByRole('button', { name: /^Call the plumber: / }).focus();
  await shell().keyboard.press('h');
  await expect(inbox.getByRole('button', { name: /^Call the plumber: / })).toHaveCount(0);
  await expect(inbox.getByRole('button', { name: 'Offsite: No update yet' })).toBeFocused();
  // Opening a project update goes to the project.
  await inbox.getByRole('button', { name: 'Offsite: No update yet' }).click();
  await expect(shell().getByRole('region', { name: 'Project updates' })).toBeVisible();
});

test('an invitation in the Inbox opens in Calendar, where Going? answers it, as Google Calendar', async () => {
  const servers = await startMailServers('app-pass', []);
  try {
    const when = new Date();
    when.setDate(when.getDate() + 3);
    const d = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}`;
    const file = path.join(userData, 'workspace', 'calendar', 'Calendar.ics');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mobius//EN', 'BEGIN:VEVENT', 'UID:lunch', `DTSTART:${d}T120000`, `DTEND:${d}T130000`, 'SUMMARY:Lunch with Rui',
      'ORGANIZER;CN=Rui Almeida:mailto:rui@example.com', 'ATTENDEE;CN=Rui Almeida;PARTSTAT=ACCEPTED:mailto:rui@example.com', 'ATTENDEE;CN=Ana;PARTSTAT=NEEDS-ACTION:mailto:ana@example.com', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'));
    await start();
    // The person's address comes from their mail account.
    await openApp('Mail');
    await shell().getByRole('button', { name: 'Add a mail account…' }).click();
    const dialog = shell().getByRole('dialog', { name: 'Add a mail account' });
    await dialog.getByRole('combobox', { name: 'Provider' }).selectOption('other');
    await dialog.getByRole('textbox', { name: 'Email address' }).fill('ana@example.com');
    await dialog.getByRole('textbox', { name: 'Incoming server (IMAP)' }).fill(`127.0.0.1:${servers.imapPort}`);
    await dialog.getByRole('textbox', { name: 'Outgoing server (SMTP)' }).fill(`127.0.0.1:${servers.smtpPort}`);
    await dialog.getByLabel('App password').fill('app-pass');
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await expect(dialog).toHaveCount(0);
    await openApp('Agent');
    const inbox = shell().getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Inbox' });
    // Answer opens the event itself in Calendar.
    await inbox.getByRole('button', { name: 'Lunch with Rui: Invitation from Rui Almeida' }).click();
    const editor = shell().getByRole('dialog', { name: 'Edit event' });
    await expect(editor.getByRole('textbox', { name: 'Title' })).toHaveValue('Lunch with Rui');
    const going = editor.getByRole('group', { name: 'Going?' });
    await going.getByRole('button', { name: 'Yes' }).click();
    await expect(going.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => fs.readFileSync(file, 'utf8').replace(/\r\n /g, '')).toMatch(/ATTENDEE[^\n]*PARTSTAT=ACCEPTED[^\n]*:mailto:ana@example\.com/);
    // Answered, it leaves the Inbox.
    await shell().keyboard.press('Escape');
    await openApp('Agent');
    await expect(inbox.getByRole('button', { name: /^Lunch with Rui/ })).toHaveCount(0);
  } finally {
    await servers.close();
  }
});
