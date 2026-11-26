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
