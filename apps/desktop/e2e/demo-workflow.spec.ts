import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, removeTestData, resizeWindow, startFixture, type Fixture, type Launched } from './harness';
import { startMailServers, type MailFixture } from './mail-fixture';
import { callsTool, says, startModel, type ModelFixture } from './model-fixture';

/**
 * The standout workflow, end to end, as a new person has Mobius (Propose, Mobius in the sidebar): an email asks for a
 * meeting and a deliverable; from Mail, one request to Mobius adds the task, books the meeting and drafts the reply;
 * the person looks at each app, keeps it all, and sends. The model is scripted, so this proves the app's side of the
 * story: what a real model's choices lead to on screen.
 *
 * Each step saves a picture (screens/workflow-NN-*.png) and what it found (screens/workflow-report.json), and a step
 * that fails is recorded and the run carries on, so one run shows every weak spot rather than only the first.
 */
const OUT = path.resolve(process.cwd(), 'screens');

let fixture: Fixture;
let servers: MailFixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;

const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const weekday = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-GB', { weekday: 'long' }); };
// The deliverable is due in two days; the meeting is the day after, at 10.
const DUE = day(2);
const MEET = day(3);

const PRIYA = [
  'From: Priya Shah <priya@northway.example>',
  'To: Andrew <andrew@northway.example>',
  'Subject: Kestrel P2: brake kit review',
  'Message-ID: <p2-brakes@northway.example>',
  'Date: Thu, 12 Nov 2026 08:41:00 +0000',
  '',
  'Hi Andrew,',
  '',
  `Can we go through the P2 brake kit together on ${weekday(3)} at 10? Half an hour should do.`,
  `Before then, could you send me the updated parts list for the P2 build, by ${weekday(2)} if possible?`,
  '',
  'Thanks,',
  'Priya',
  '',
].join('\r\n');
const SUPPLIER = 'From: Orbis Parts <orders@orbis.example>\r\nTo: Andrew <andrew@northway.example>\r\nSubject: Order 4471 shipped\r\nDate: Wed, 11 Nov 2026 16:10:00 +0000\r\n\r\nYour order of caliper brackets has shipped.\r\n';

interface Step { n: number; name: string; ok: boolean; notes: string[]; picture: string; ms: number }
const report: { started: string; steps: Step[]; attachedEmail?: boolean; approvalsAsked: string[]; requests?: number } = { started: new Date().toISOString(), steps: [], approvalsAsked: [] };

const shell = (): Page => mobius!.shell;
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const file = (rel: string) => path.join(userData, 'workspace', rel);
const read = (rel: string) => (fs.existsSync(file(rel)) ? fs.readFileSync(file(rel), 'utf8') : '');

async function picture(name: string): Promise<string> {
  await shell().evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  await shell().waitForTimeout(400);
  const to = path.join(OUT, `${name}.png`);
  await shell().screenshot({ path: to }).catch(() => undefined);
  return path.basename(to);
}

/** One step of the story: run it, note what went wrong without stopping, and take its picture. */
async function step(name: string, body: (note: (s: string) => void) => Promise<void>): Promise<void> {
  const n = report.steps.length + 1;
  const notes: string[] = [];
  const t0 = Date.now();
  let ok = true;
  try {
    await body((s) => notes.push(s));
  } catch (e) {
    ok = false;
    notes.push(`FAILED: ${String((e as Error).message ?? e).split('\n').slice(0, 4).join(' ')}`);
  }
  const shot = await picture(`workflow-${pad(n)}-${name}`);
  report.steps.push({ n, name, ok, notes, picture: shot, ms: Date.now() - t0 });
  fs.writeFileSync(path.join(OUT, 'workflow-report.json'), JSON.stringify(report, null, 2));
}

/** Allows whatever Mobius stops to ask about, as the person would in the demo, and notes each one. */
async function allowAsked(until: Locator, timeout = 30_000): Promise<void> {
  const card = log().getByRole('group', { name: /Approval needed/ });
  for (const end = Date.now() + timeout; Date.now() < end;) {
    if (await until.count()) return;
    if (await card.count()) {
      report.approvalsAsked.push((await card.first().getAttribute('aria-label')) ?? 'Approval needed');
      await card.first().getByRole('button', { name: 'Allow once' }).click();
      continue;
    }
    await shell().waitForTimeout(150);
  }
}

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

test.beforeEach(async () => {
  fixture = await startFixture();
  servers = await startMailServers('app-pass', [{ uid: 7, flags: '', raw: PRIYA }, { uid: 6, flags: '\\Seen', raw: SUPPLIER }]);
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-workflow-'));
  // What is already there: a P2 list in Tasks, and a stand-up the morning of the meeting.
  const write = (rel: string, content: string) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), content); };
  write('tasks/Kestrel P2.md', '# Kestrel P2\n\n- [ ] Confirm the wiring loom supplier\n- [ ] Book the rolling-road slot\n- [x] Sign off the chassis drawings\n');
  const ics = (d: string) => d.replace(/-/g, '');
  write('calendar/Calendar.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mobius//EN', 'BEGIN:VEVENT', 'UID:standup', `DTSTART:${ics(MEET)}T090000`, `DTEND:${ics(MEET)}T093000`, 'SUMMARY:P2 stand-up', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'));
});

test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await servers.close();
  await fixture.close();
  removeTestData(userData);
});

test('workflow: an email becomes a task, a meeting and a reply, kept and sent from one request', async () => {
  test.setTimeout(5 * 60_000);
  // What a capable model would do with "handle this": find and read the email, check the day, then the three changes.
  model = await startModel([
    callsTool('mail-search', { query: 'brake kit' }),
    callsTool('mail-read', { id: '{{request:([0-9a-f]{8}/inbox/7)}}' }),
    callsTool('calendar-list', { from: MEET, to: MEET }),
    callsTool('tasks-add', { list: 'Kestrel P2', text: 'Send Priya the updated P2 parts list', due: DUE, flagged: true }),
    callsTool('calendar-add', { calendar: 'Calendar', title: 'P2 brake kit review with Priya', start: `${MEET}T10:00`, end: `${MEET}T10:30` }),
    callsTool('mail-draft', { replyTo: '{{request:([0-9a-f]{8}/inbox/7)}}', body: `Hi Priya,\n\n${weekday(3)} at 10 works. I've put it in for half an hour. You'll have the updated parts list by ${weekday(2)}.\n\nAndrew`, why: 'Confirms the time and when the parts list will reach her.' }),
    says(['Done. I added “Send Priya the updated P2 parts list” to Kestrel P2, due ', weekday(2), '; put the brake kit review in your calendar for ', weekday(3), ' at 10:00, after your stand-up; and drafted a reply for you to check. Nothing is sent.']),
  ]);
  mobius = await launch(fixture.origin + '/', { newPerson: true, openMobius: true, userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await resizeWindow(mobius.app, 1440, 900).catch(() => undefined);
  await expect(composer()).toBeEnabled({ timeout: 20_000 });

  await step('mail-signed-in', async (note) => {
    await shell().keyboard.press('Control+k');
    await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Mail');
    await shell().keyboard.press('Enter');
    const page = shell().locator('.mail-page');
    await expect(page).toBeVisible();
    await shell().getByRole('button', { name: 'Add a mail account…' }).click();
    const dialog = shell().getByRole('dialog', { name: 'Add a mail account' });
    await dialog.getByRole('combobox', { name: 'Provider' }).selectOption('other');
    await dialog.getByRole('textbox', { name: 'Email address' }).fill('andrew@northway.example');
    await dialog.getByRole('textbox', { name: 'Incoming server (IMAP)' }).fill(`127.0.0.1:${servers.imapPort}`);
    await dialog.getByRole('textbox', { name: 'Outgoing server (SMTP)' }).fill(`127.0.0.1:${servers.smtpPort}`);
    await dialog.getByLabel('App password').fill('app-pass');
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await expect(dialog).toHaveCount(0);
    const rows = page.getByRole('listbox', { name: 'Messages' }).getByRole('option');
    await expect(rows.first()).toBeVisible();
    note(`messages in the list: ${await rows.count()}`);
  });

  await step('email-open', async (note) => {
    const page = shell().locator('.mail-page');
    await page.getByRole('listbox', { name: 'Messages' }).getByRole('option', { name: /brake kit/ }).first().click();
    await expect(page.getByRole('article')).toContainText('updated parts list');
    // Is Mobius still in the sidebar, and what does it offer for this email?
    const offered = await shell().locator('.rail').getByRole('button').allInnerTexts().catch(() => []);
    note(`sidebar buttons: ${offered.filter(Boolean).slice(0, 20).join(' | ')}`);
  });

  await step('asked-mobius', async (note) => {
    await expect(composer()).toBeVisible({ timeout: 5000 });
    await composer().fill('Handle this one: add the parts list to my P2 tasks, book the review, and draft a reply.');
    await composer().press('Enter');
    await allowAsked(log().locator('.msg.assistant').filter({ hasText: 'Nothing is sent.' }), 60_000);
    await expect(log().locator('.msg.assistant').last()).toContainText('Nothing is sent.', { timeout: 30_000 });
    await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
    const first = JSON.stringify(model!.requests[0]?.messages ?? []);
    report.attachedEmail = first.includes('updated parts list');
    report.requests = model!.requests.length;
    note(`the open email was attached to the request: ${report.attachedEmail}`);
    note(`approvals asked: ${report.approvalsAsked.join(', ') || 'none'}`);
    note(`tools the model was offered: ${((model!.requests[0]?.tools as Array<{ function: { name: string } }> | undefined) ?? []).map((t) => t.function.name).filter((n) => /mail|task|calendar/.test(n)).join(', ')}`);
  });

  await step('changes-summary', async (note) => {
    const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
    await expect(strip).toBeVisible({ timeout: 5000 });
    note(`review strip: ${(await strip.innerText()).replace(/\s+/g, ' ')}`);
    await strip.getByRole('button', { name: /Review/ }).first().click().catch(() => undefined);
    note(`expanded: ${(await strip.innerText()).replace(/\s+/g, ' ')}`);
    note(`tasks file now: ${read('tasks/Kestrel P2.md').split('\n').filter((l) => l.includes('Priya')).join(' / ') || '(no Priya task)'}`);
    note(`calendar file has the review: ${read('calendar/Calendar.ics').includes('P2 brake kit review')}`);
  });

  await step('suggested-reply-in-mail', async (note) => {
    const suggested = shell().locator('.mail-page').getByLabel('Suggested reply');
    await expect(suggested).toBeVisible({ timeout: 5000 });
    note(`suggested reply: ${(await suggested.innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
  });

  await step('task-in-tasks', async (note) => {
    await shell().keyboard.press('Control+k');
    await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Tasks');
    await shell().keyboard.press('Enter');
    const page = shell().locator('.app[data-app="tasks"]');
    await expect(page).toBeVisible();
    await shell().getByRole('button', { name: /^Kestrel P2/ }).first().click();
    const row = page.locator('.task', { hasText: 'Send Priya the updated P2 parts list' });
    await expect(row).toBeVisible();
    note(`row: ${(await row.innerText()).replace(/\s+/g, ' ')}; proposed (dashed): ${(await row.getAttribute('data-proposed')) !== null}`);
    note(`review strip still shown here: ${await shell().getByRole('region', { name: 'Changes from the last turn' }).count() > 0}`);
  });

  await step('event-in-calendar', async (note) => {
    await shell().keyboard.press('Control+k');
    await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Calendar');
    await shell().keyboard.press('Enter');
    const page = shell().locator('.app[data-app="calendar"]');
    await expect(page).toBeVisible();
    let event = page.getByRole('button', { name: /^P2 brake kit review with Priya/ });
    if (!(await event.count())) {
      note('not in the first view; trying the next week');
      await page.getByRole('button', { name: /Next/ }).first().click().catch(() => undefined);
      event = page.getByRole('button', { name: /^P2 brake kit review with Priya/ });
    }
    await expect(event.first()).toBeVisible({ timeout: 5000 });
    note(`event: ${await event.first().getAttribute('aria-label')}`);
    note(`stand-up still there: ${await page.getByRole('button', { name: /^P2 stand-up/ }).count() > 0}`);
  });

  await step('kept-all', async (note) => {
    const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
    await expect(strip).toBeVisible({ timeout: 5000 });
    await strip.getByRole('button', { name: /^Keep all changes/ }).click();
    await expect(strip).toHaveCount(0, { timeout: 5000 });
    note(`after Keep all, calendar file has the review: ${read('calendar/Calendar.ics').includes('P2 brake kit review')}`);
  });

  await step('reply-sent', async (note) => {
    await shell().keyboard.press('Control+k');
    await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Mail');
    await shell().keyboard.press('Enter');
    const page = shell().locator('.mail-page');
    const suggested = page.getByLabel('Suggested reply');
    await expect(suggested).toBeVisible({ timeout: 5000 });
    await suggested.getByRole('button', { name: 'Keep' }).click();
    const form = page.getByRole('form', { name: 'Reply' });
    await expect(form.getByRole('textbox', { name: 'Message' })).toHaveValue(/parts list/);
    await picture(`workflow-${pad(report.steps.length + 1)}-reply-before-send`);
    await form.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => servers.sent.length, { timeout: 10_000 }).toBe(1);
    note(`sent: ${servers.sent[0]!.includes('In-Reply-To: <p2-brakes@northway.example>') ? 'as a reply to Priya' : 'NOT threaded as a reply'}`);
  });

  report.steps.forEach((s) => console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${pad(s.n)} ${s.name} (${s.ms} ms)${s.notes.map((x) => `\n       ${x}`).join('')}`));
  expect(report.steps.filter((s) => !s.ok).map((s) => s.name)).toEqual([]);
});

test('workflow: the same request, then Discard puts Tasks and Calendar back as they were', async () => {
  test.setTimeout(3 * 60_000);
  model = await startModel([
    callsTool('tasks-add', { list: 'Kestrel P2', text: 'Send Priya the updated P2 parts list', due: DUE }),
    callsTool('calendar-add', { calendar: 'Calendar', title: 'P2 brake kit review with Priya', start: `${MEET}T10:00`, end: `${MEET}T10:30` }),
    says(['Added the task and the meeting.']),
  ]);
  mobius = await launch(fixture.origin + '/', { newPerson: true, openMobius: true, userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await resizeWindow(mobius.app, 1440, 900).catch(() => undefined);
  await expect(composer()).toBeEnabled({ timeout: 20_000 });
  const before = { tasks: read('tasks/Kestrel P2.md'), calendar: read('calendar/Calendar.ics') };
  await step('discard-asked', async () => {
    await composer().fill('Add the parts list task and book the brake kit review');
    await composer().press('Enter');
    await allowAsked(log().locator('.msg.assistant').filter({ hasText: 'Added the task' }));
    await expect(log().locator('.msg.assistant').last()).toHaveText('Added the task and the meeting.');
  });
  await step('discarded', async (note) => {
    const strip = shell().getByRole('region', { name: 'Changes from the last turn' });
    await expect(strip).toBeVisible();
    await strip.getByRole('button', { name: /Review/ }).first().click();
    const discard = strip.getByRole('button', { name: /^Discard all changes/ });
    note(`discard buttons: ${await discard.count()}`);
    await discard.first().click();
    await expect.poll(() => read('tasks/Kestrel P2.md')).toBe(before.tasks);
    await expect.poll(() => read('calendar/Calendar.ics')).toBe(before.calendar);
  });
  expect(report.steps.filter((s) => s.name.startsWith('discard') && !s.ok).map((s) => s.notes.join(' '))).toEqual([]);
});
