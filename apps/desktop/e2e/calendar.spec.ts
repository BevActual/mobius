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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-calendar-'));
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
const page = (): Locator => shell().locator('.calendar-page');
/** Calendar's controls in the toolbar: where to go, the view, quick add and New. */
const tools = (): Locator => shell().getByRole('group', { name: 'Calendar' });
const file = (name: string) => path.join(userData, 'workspace', 'calendar', `${name}.ics`);
const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ics = (d: string) => d.replace(/-/g, '');
const today = () => day(new Date());
/** A time as the app writes it, following the computer's clock: "13:00", or "1:00 PM" on the 12-hour clock. */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `(?:0?${h}:${pad(m)}|${((h + 11) % 12) + 1}:${pad(m)}\\s?${h < 12 ? 'AM' : 'PM'})`;
};
/** From one time to another, as an event's name says it. */
const span = (from: string, to: string) => `${at(from)}–${at(to)}`;

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Calendar');
  await shell().keyboard.press('Enter');
  await expect(page()).toBeVisible();
}

test('a calendar file from another app shows in the week, and events are added, changed and removed in it', async () => {
  fs.mkdirSync(path.dirname(file('Work')), { recursive: true });
  fs.writeFileSync(file('Work'), `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nBEGIN:VEVENT\r\nUID:standup\r\nDTSTART:${ics(today())}T090000\r\nDURATION:PT30M\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Standup\r\nBEGIN:VALARM\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  await start();
  await tools().getByRole('radio', { name: 'Week' }).click();
  await expect(page().getByRole('button', { name: new RegExp(`^Standup, ${span('9:00', '9:30')}, Work`) }).first()).toBeVisible();
  await expect(shell().getByRole('region', { name: 'Calendars' }).getByText('Work')).toBeVisible();

  // New event: the editor opens at the next hour today.
  await shell().getByRole('button', { name: 'Create' }).click();
  const editor = shell().getByRole('dialog', { name: 'New event' });
  await editor.getByRole('textbox', { name: 'Title' }).fill('Water the plants');
  await editor.getByRole('checkbox', { name: 'All day' }).check();
  await editor.getByLabel('Start day').fill(today());
  await editor.getByLabel('End day').fill(today());
  await editor.getByRole('combobox', { name: 'Calendar' }).selectOption('Calendar');
  await editor.getByRole('button', { name: 'Add' }).click();
  await expect(editor).toHaveCount(0);
  const plants = page().getByRole('button', { name: /^Water the plants, All day/ });
  await expect(plants).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Calendar'), 'utf8')).toContain(`DTSTART;VALUE=DATE:${ics(today())}`);

  // Changing the title of a repeating event keeps its times, and what Mobius does not use stays in the file.
  await page().getByRole('button', { name: /^Standup/ }).first().click();
  const change = shell().getByRole('dialog', { name: 'Edit event' });
  await expect(change.getByText('This event repeats.')).toBeVisible();
  await change.getByRole('textbox', { name: 'Title' }).fill('Team standup');
  // The popover has no Save: Enter keeps the change.
  await change.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(page().getByRole('button', { name: new RegExp(`^Team standup, ${span('9:00', '9:30')}`) }).first()).toBeVisible();
  const work = fs.readFileSync(file('Work'), 'utf8');
  expect(work).toContain('RRULE:FREQ=DAILY;COUNT=3');
  expect(work).toContain('TRIGGER:-PT5M');
  expect(work).toContain(`DTSTART:${ics(today())}T090000`);

  await plants.click();
  await shell().getByRole('dialog', { name: 'Edit event' }).getByRole('button', { name: 'Delete Event' }).click();
  await expect(plants).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Calendar'), 'utf8')).not.toContain('Water the plants');

  // Unticking a calendar hides its events; the month shows them too.
  await shell().getByRole('region', { name: 'Calendars' }).getByRole('checkbox', { name: 'Work' }).uncheck();
  await expect(page().getByRole('button', { name: /^Team standup/ })).toHaveCount(0);
  await shell().getByRole('region', { name: 'Calendars' }).getByRole('checkbox', { name: 'Work' }).check();
  await tools().getByRole('radio', { name: 'Month' }).click();
  await expect(page().locator('.cal-month-cell[data-today]').getByRole('button', { name: /^Team standup/ })).toBeVisible();
});

test('an event typed in words is set to repeat, then dragged an hour later, and every time it happens moves', async () => {
  await start();
  await tools().getByRole('radio', { name: 'Day' }).click();
  const tomorrow = day(new Date(Date.now() + 86_400_000));
  // The toolbar's + opens a field to say the event in words.
  await tools().getByRole('button', { name: 'Quick event' }).click();
  const quick = tools().getByRole('textbox', { name: 'Quick add an event' });
  await quick.fill('Site walk tomorrow 10am for 30m');
  await expect(tools().getByRole('status').filter({ hasText: 'Site walk' })).toContainText(new RegExp(span('10:00', '10:30')));
  await quick.press('Enter');
  // The day it is on opens.
  const walk = (time: string) => page().getByRole('button', { name: new RegExp(`^Site walk, ${time}`) });
  await expect(walk(span('10:00', '10:30'))).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Calendar'), 'utf8')).toContain(`DTSTART:${ics(tomorrow)}T100000`);

  await walk(span('10:00', '10:30')).click();
  const editor = shell().getByRole('dialog', { name: 'Edit event' });
  await editor.getByRole('combobox', { name: 'Repeat' }).selectOption('Every day');
  await editor.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(editor).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Calendar'), 'utf8')).toContain('RRULE:FREQ=DAILY');

  // Dragged down an hour (48 pixels), the whole series moves, and Undo is offered.
  const box = (await walk(span('10:00', '10:30')).boundingBox())!;
  await shell().mouse.move(box.x + box.width / 2, box.y + 8);
  await shell().mouse.down();
  await shell().mouse.move(box.x + box.width / 2, box.y + 30, { steps: 4 });
  await shell().mouse.move(box.x + box.width / 2, box.y + 56, { steps: 4 });
  await shell().mouse.up();
  await expect(walk(span('11:00', '11:30'))).toBeVisible();
  await expect(page().getByRole('status').filter({ hasText: 'Moved “Site walk”' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Calendar'), 'utf8')).toContain(`DTSTART:${ics(tomorrow)}T110000`);
  expect(fs.readFileSync(file('Calendar'), 'utf8')).toContain('RRULE:FREQ=DAILY');

  // The next day has it at the new time too; the arrow key goes there.
  await shell().locator('body').press('ArrowRight');
  await expect(walk(span('11:00', '11:30'))).toBeVisible();
  await shell().locator('body').press('m');
  await expect(tools().getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
});

test('the agent adds an event from the panel beside the calendar, after asking, and it shows at once', async () => {
  await start([callsTool('calendar-add', { calendar: 'Calendar', title: 'Dentist', start: `${today()}T15:00`, location: 'Main St' }), says(['It is in your calendar.'])]);
  await tools().getByRole('radio', { name: 'Day' }).click();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Put the dentist in for 3pm today');
  await composer.press('Enter');
  const card = shell().getByRole('log', { name: 'Conversation' }).getByRole('group', { name: 'Approval needed: calendar.add' });
  await expect(card).toContainText('add “Dentist” to your calendar');
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('It is in your calendar.');
  await expect(page().getByRole('button', { name: new RegExp(`^Dentist, ${span('15:00', '16:00')}, Main St, Calendar`) })).toBeVisible();
  const written = fs.readFileSync(file('Calendar'), 'utf8');
  expect(written).toContain(`DTSTART:${ics(today())}T150000`);
  expect(written).toContain('LOCATION:Main St');
});

test('the sidebar search finds an event weeks away, and picking it goes to its day', async () => {
  const later = new Date();
  later.setDate(later.getDate() + 20);
  fs.mkdirSync(path.dirname(file('Work')), { recursive: true });
  fs.writeFileSync(file('Work'), `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nBEGIN:VEVENT\r\nUID:audit\r\nDTSTART:${ics(day(later))}T140000\r\nDURATION:PT1H\r\nSUMMARY:Supplier audit\r\nLOCATION:Veltro plant\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  await start();
  await tools().getByRole('radio', { name: 'Week' }).click();
  await expect(page().getByRole('button', { name: /^Supplier audit/ })).toHaveCount(0);
  await shell().getByRole('searchbox', { name: 'Search events' }).fill('veltro');
  const hits = shell().getByRole('region', { name: 'Events' });
  await hits.getByRole('button', { name: /Supplier audit/ }).click();
  await expect(page().getByRole('button', { name: new RegExp(`^Supplier audit, ${span('14:00', '15:00')}, Veltro plant, Work`) })).toBeVisible();
  await shell().getByRole('searchbox', { name: 'Search events' }).fill('nothing like this');
  await expect(shell().getByText('No events match “nothing like this”.')).toBeVisible();
});

test('an event the agent adds next week opens Calendar on that week, dashed, with Keep and Discard', async () => {
  const ahead = new Date();
  ahead.setDate(ahead.getDate() + 8);
  await start([callsTool('calendar-add', { calendar: 'Calendar', title: 'Kickoff', start: `${day(ahead)}T10:00` }), says(['Kickoff is in for next week.'])]);
  await tools().getByRole('radio', { name: 'Week' }).click();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Put the kickoff in for next week');
  await composer.press('Enter');
  const card = shell().getByRole('log', { name: 'Conversation' }).getByRole('group', { name: 'Approval needed: calendar.add' });
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Kickoff is in for next week.');

  // The week moves to the new event, drawn dashed, and the bar says what changed.
  const kickoff = page().getByRole('button', { name: /^Added by Mobius: Kickoff/ });
  await expect(kickoff).toBeVisible();
  await expect(kickoff).toHaveAttribute('data-proposed', 'true');
  const bar = page().locator('.cal-review');
  await expect(bar).toContainText('“Kickoff”');
  await bar.getByRole('button', { name: 'Keep' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page().getByRole('button', { name: /^Kickoff/ })).toBeVisible();
  expect(fs.readFileSync(file('Calendar'), 'utf8')).toContain('SUMMARY:Kickoff');
});

test('a subscribed calendar link shows beside the person\'s own, and its events can be read but not changed', async () => {
  await start();
  await tools().getByRole('radio', { name: 'Week' }).click();
  await shell().getByRole('button', { name: 'Add a calendar account…' }).click();
  const dialog = shell().getByRole('dialog', { name: 'Add a calendar account' });
  await dialog.getByRole('textbox', { name: 'Calendar link' }).fill(`${fixture.origin}/page-that-is-not-a-calendar`);
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Holidays');
  await dialog.getByRole('button', { name: 'Subscribe' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Calendar link' }).fill(`${fixture.origin}/holidays.ics`);
  await dialog.getByRole('button', { name: 'Subscribe' }).click();
  await expect(dialog).toHaveCount(0);

  const group = shell().getByRole('region', { name: 'Holidays' });
  await expect(group.getByRole('checkbox', { name: 'Holidays' })).toBeChecked();
  await expect(group.getByRole('img', { name: 'Read only' })).toBeVisible();
  const event = page().getByRole('button', { name: /^Founders Day, All day, Holidays/ });
  await expect(event).toBeVisible();
  await event.click();
  const view = shell().getByRole('dialog', { name: 'Event' });
  await expect(view.getByText('a subscribed calendar')).toBeVisible();
  await expect(view.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(view.getByRole('textbox', { name: 'Title' })).toBeDisabled();
  await shell().keyboard.press('Escape');
  await expect(view).toHaveCount(0);

  // New events go only to calendars that can take them.
  await shell().getByRole('button', { name: 'Create' }).click();
  await expect(shell().getByRole('dialog', { name: 'New event' }).getByRole('combobox', { name: 'Calendar' })).toHaveCount(0);
  await shell().getByRole('dialog', { name: 'New event' }).getByRole('button', { name: 'Cancel' }).click();

  await group.getByRole('button', { name: 'Remove Holidays' }).click();
  await expect(event).toHaveCount(0);
});

test('the agent suggests an event without asking, and it is added only when the person chooses Add', async () => {
  await start([
    callsTool('calendar-suggest', { title: 'Prep slides', start: `${today()}T10:00`, why: 'Your first free hour before the kickoff.' }),
    callsTool('calendar-suggest', { title: 'Gym', start: `${today()}T18:00`, why: 'You said twice a week.' }),
    says(['I suggested two things.']),
  ]);
  await tools().getByRole('radio', { name: 'Day' }).click();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Find me time to prep the slides');
  await composer.press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('I suggested two things.');
  await expect(shell().getByRole('log', { name: 'Conversation' }).getByRole('group', { name: /Approval needed/ })).toHaveCount(0);

  // Each suggestion is a dashed event; it opens beside itself with why, and Keep, Try another and Discard.
  const ghost = page().getByRole('button', { name: new RegExp(`^Suggested: Prep slides, ${span('10:00', '11:00')}`) });
  await expect(ghost).toBeVisible();
  expect(fs.existsSync(file('Calendar')) ? fs.readFileSync(file('Calendar'), 'utf8') : '').not.toContain('Prep slides');
  await ghost.click();
  const prep = shell().getByRole('dialog', { name: 'Suggested: Prep slides' });
  await expect(prep).toContainText('Your first free hour before the kickoff.');
  await shell().keyboard.press('Escape');
  await expect(prep).toHaveCount(0);

  // Like every proposal: Discard declines it, Keep adds it.
  await page().getByRole('button', { name: /^Suggested: Gym/ }).click();
  await shell().getByRole('dialog', { name: 'Suggested: Gym' }).getByRole('button', { name: 'Discard' }).click();
  await ghost.click();
  await prep.getByRole('button', { name: 'Keep' }).click();
  await expect(page().getByRole('button', { name: /^Suggested:/ })).toHaveCount(0);
  await expect(page().getByRole('button', { name: new RegExp(`^Prep slides, ${span('10:00', '11:00')}, Calendar`) })).toBeVisible();
  await expect(page().getByRole('button', { name: /Gym/ })).toHaveCount(0);
  expect(fs.readFileSync(file('Calendar'), 'utf8')).toContain('SUMMARY:Prep slides');
});

test('an event opens in a popover beside it, and the event picked out is duplicated, deleted and moved from the keys and its menu', async () => {
  fs.mkdirSync(path.dirname(file('Work')), { recursive: true });
  fs.writeFileSync(file('Work'), `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nBEGIN:VEVENT\r\nUID:budget\r\nDTSTART:${ics(today())}T110000\r\nDTEND:${ics(today())}T120000\r\nSUMMARY:Budget review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  fs.writeFileSync(file('Home'), 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nEND:VCALENDAR\r\n');
  await start();
  await tools().getByRole('radio', { name: 'Week' }).click();
  const review = (title = 'Budget review') => page().getByRole('button', { name: new RegExp(`^${title}, ${span('11:00', '12:00')}`) });

  // A popover, not a sheet over a dimmed window; a press elsewhere keeps what was typed.
  await review().click();
  const pop = shell().getByRole('dialog', { name: 'Edit event' });
  await expect(pop).toHaveAttribute('data-pop', 'true');
  await expect(shell().locator('.cal-editor-backdrop')).toHaveCount(0);
  await expect(pop.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await pop.getByRole('textbox', { name: 'Title' }).fill('Budget review Q4');
  await page().locator('.cal-hours').click({ position: { x: 10, y: 10 } });
  await expect(pop).toHaveCount(0);
  await expect(review('Budget review Q4')).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Work'), 'utf8')).toContain('SUMMARY:Budget review Q4');

  // Opened, it stays picked out once closed: Ctrl+D copies it and Delete takes the copy away again, each with Undo.
  await review('Budget review Q4').click();
  await shell().keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(review('Budget review Q4')).toHaveAttribute('data-selected', 'true');
  await shell().keyboard.press('Control+d');
  await expect(review('Budget review Q4')).toHaveCount(2);
  await expect(page().getByRole('status').filter({ hasText: 'Duplicated “Budget review Q4”' })).toBeVisible();
  await shell().keyboard.press('Delete');
  await expect(review('Budget review Q4')).toHaveCount(1);
  await expect(page().getByRole('status').filter({ hasText: 'Deleted “Budget review Q4”' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Work'), 'utf8').match(/SUMMARY:Budget review Q4/g)?.length).toBe(1);

  // Its menu moves it to another calendar.
  await review('Budget review Q4').click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Budget review Q4' }).getByRole('menuitem', { name: 'Move to Home' }).click();
  await expect(page().getByRole('button', { name: new RegExp(`^Budget review Q4, ${span('11:00', '12:00')}, Home`) })).toBeVisible();
  await expect.poll(() => fs.readFileSync(file('Home'), 'utf8')).toContain('SUMMARY:Budget review Q4');
  expect(fs.readFileSync(file('Work'), 'utf8')).not.toContain('Budget review Q4');

  // Empty time has a menu too: a new event there, edited beside it.
  await page().locator('.cal-column').first().click({ button: 'right', position: { x: 20, y: 14 * 48 + 10 } });
  await shell().getByRole('menu').getByRole('menuitem', { name: new RegExp(`^New event at ${at('14:00')}$`) }).click();
  const made = shell().getByRole('dialog', { name: 'New event' });
  await expect(made).toHaveAttribute('data-pop', 'true');
  await expect(made.getByRole('textbox', { name: 'Start time' })).toHaveValue(/2(:00)?\s?PM|14:00/);
  await expect(made.getByRole('button', { name: /Cancel|Save|Add/ })).toHaveCount(0);
  await shell().keyboard.press('Escape');
  await expect(made).toHaveCount(0);
});
