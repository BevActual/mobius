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
const file = (name: string) => path.join(userData, 'workspace', 'calendar', `${name}.ics`);
const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ics = (d: string) => d.replace(/-/g, '');
const today = () => day(new Date());

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
  await page().getByRole('radio', { name: 'Week' }).click();
  await expect(page().getByRole('button', { name: /^Standup, 9:00–9:30, Work/ }).first()).toBeVisible();
  await expect(shell().getByRole('list', { name: 'Calendars' }).getByText('Work')).toBeVisible();

  // New event: the editor opens at the next hour today.
  await page().getByRole('button', { name: 'New event' }).click();
  const editor = shell().getByRole('dialog', { name: 'New event' });
  await editor.getByRole('textbox', { name: 'Title' }).fill('Water the plants');
  await editor.getByRole('checkbox', { name: 'All day' }).check();
  await editor.getByLabel('Start day').fill(today());
  await editor.getByLabel('End day').fill(today());
  await editor.getByRole('combobox').selectOption('Calendar');
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
  await change.getByRole('button', { name: 'Save' }).click();
  await expect(page().getByRole('button', { name: /^Team standup, 9:00–9:30/ }).first()).toBeVisible();
  const work = fs.readFileSync(file('Work'), 'utf8');
  expect(work).toContain('RRULE:FREQ=DAILY;COUNT=3');
  expect(work).toContain('TRIGGER:-PT5M');
  expect(work).toContain(`DTSTART:${ics(today())}T090000`);

  await plants.click();
  await shell().getByRole('dialog', { name: 'Edit event' }).getByRole('button', { name: 'Delete' }).click();
  await expect(plants).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file('Calendar'), 'utf8')).not.toContain('Water the plants');

  // Unticking a calendar hides its events; the month shows them too.
  await shell().getByRole('list', { name: 'Calendars' }).getByRole('checkbox', { name: 'Work' }).uncheck();
  await expect(page().getByRole('button', { name: /^Team standup/ })).toHaveCount(0);
  await shell().getByRole('list', { name: 'Calendars' }).getByRole('checkbox', { name: 'Work' }).check();
  await page().getByRole('radio', { name: 'Month' }).click();
  await expect(page().locator('.cal-month-cell[data-today]').getByRole('button', { name: /^Team standup/ })).toBeVisible();
});

test('the agent adds an event from the panel beside the calendar, after asking, and it shows at once', async () => {
  await start([callsTool('calendar-add', { calendar: 'Calendar', title: 'Dentist', start: `${today()}T15:00`, location: 'Main St' }), says(['It is in your calendar.'])]);
  await page().getByRole('radio', { name: 'Day' }).click();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Put the dentist in for 3pm today');
  await composer.press('Enter');
  const card = shell().getByRole('log', { name: 'Conversation' }).getByRole('group', { name: 'Approval needed: calendar.add' });
  await expect(card).toContainText('add “Dentist” to your calendar');
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('It is in your calendar.');
  await expect(page().getByRole('button', { name: /^Dentist, 15:00–16:00, Main St, Calendar/ })).toBeVisible();
  const written = fs.readFileSync(file('Calendar'), 'utf8');
  expect(written).toContain(`DTSTART:${ics(today())}T150000`);
  expect(written).toContain('LOCATION:Main St');
});

test('a subscribed calendar link shows beside the person\'s own, and its events can be read but not changed', async () => {
  await start();
  await page().getByRole('radio', { name: 'Week' }).click();
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
  await view.getByRole('button', { name: 'Close' }).click();

  // New events go only to calendars that can take them.
  await page().getByRole('button', { name: 'New event' }).click();
  await expect(shell().getByRole('dialog', { name: 'New event' }).getByRole('combobox')).toHaveCount(0);
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
  await page().getByRole('radio', { name: 'Day' }).click();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Find me time to prep the slides');
  await composer.press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('I suggested two things.');
  await expect(shell().getByRole('log', { name: 'Conversation' }).getByRole('group', { name: /Approval needed/ })).toHaveCount(0);

  const box = page().getByRole('region', { name: 'Suggested by Mobius' });
  await expect(box.getByRole('article', { name: 'Prep slides' })).toContainText('Your first free hour before the kickoff.');
  await expect(page().getByRole('button', { name: /^Suggested: Prep slides, 10:00–11:00/ })).toBeVisible();
  expect(fs.existsSync(file('Calendar')) ? fs.readFileSync(file('Calendar'), 'utf8') : '').not.toContain('Prep slides');

  // Like every proposal: Discard declines it, Keep adds it.
  await box.getByRole('article', { name: 'Gym' }).getByRole('button', { name: 'Discard' }).click();
  await box.getByRole('article', { name: 'Prep slides' }).getByRole('button', { name: 'Keep' }).click();
  await expect(box).toHaveCount(0);
  await expect(page().getByRole('button', { name: /^Prep slides, 10:00–11:00, Calendar/ })).toBeVisible();
  await expect(page().getByRole('button', { name: /Gym/ })).toHaveCount(0);
  expect(fs.readFileSync(file('Calendar'), 'utf8')).toContain('SUMMARY:Prep slides');
});
