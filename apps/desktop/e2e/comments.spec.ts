import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { startMailServers, type MailFixture } from './mail-fixture';
import { says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let servers: MailFixture | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-comments-'));
  const book = path.join(userData, 'workspace', 'sheets', 'Offsite budget');
  fs.mkdirSync(book, { recursive: true });
  fs.writeFileSync(path.join(book, 'Budget.csv'), 'Item,Qty,Unit,Total\nHotel,14,320,=B2*C2\nTotal,,,=SUM(D2:D2)\n');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await servers?.close();
  servers = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const comments = (): Locator => shell().getByRole('button', { name: 'Comments', exact: true });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
}
async function openApp(name: string): Promise<void> {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
  await shell().keyboard.press('Enter');
}

test('a comment on a sheet cell is pinned there and can be kept as a note, for people only', async () => {
  await start();
  await openApp('Sheets');
  await shell().getByRole('navigation', { name: 'Workbooks' }).getByRole('button', { name: /^Offsite budget/ }).click();
  const cell = shell().getByRole('grid').getByRole('gridcell', { name: 'C2', exact: true });
  await expect(cell).toHaveText('320');

  // Comment mode, from the button; a click on the cell starts a comment there instead of selecting it.
  await comments().click();
  await expect(comments()).toHaveAttribute('aria-pressed', 'true');
  await cell.click();
  const draft = shell().getByRole('dialog', { name: 'New comment' });
  await draft.getByRole('textbox', { name: 'Comment' }).fill('Is the rate per night?');
  await draft.getByRole('button', { name: 'Comment' }).click();

  const card = shell().getByRole('dialog', { name: 'Comment on C2' });
  await expect(card).toContainText('Is the rate per night?');
  await card.getByRole('button', { name: 'Keep as a note' }).click();
  await expect(card).toContainText('Mobius does not read it');
  const pin = shell().getByRole('button', { name: 'Comment on C2: Is the rate per night?' });
  await expect(pin).toHaveAttribute('data-state', 'note');

  // Kept per document in the workspace's dot folder, with what it is on.
  const kept = path.join(userData, 'workspace', '.comments', 'sheets', 'Offsite budget~Budget.json');
  // The file is first written when the comment is made (still open), so wait for the save that keeps it as a note.
  const read = () => { try { return JSON.parse(fs.readFileSync(kept, 'utf8'))[0]?.state; } catch { return undefined; } };
  await expect.poll(read).toBe('note');
  const saved = JSON.parse(fs.readFileSync(kept, 'utf8'));
  expect(saved[0]).toMatchObject({ doc: 'Offsite budget/Budget', anchor: { id: 'C2' }, state: 'note', text: 'Is the rate per night?', context: '320' });

  // The badge counts the open threads; the sidebar lists them; C leaves comment mode.
  await expect(comments()).toContainText('1');
  await expect(shell().getByRole('region', { name: 'Comments' })).toContainText('Is the rate per night?');
  // Escape leaves comment mode, and C turns it on and off again.
  await shell().keyboard.press('Escape');
  await expect(comments()).toHaveAttribute('aria-pressed', 'false');
  await shell().locator('body').press('c');
  await expect(comments()).toHaveAttribute('aria-pressed', 'true');
  await shell().locator('body').press('c');
  await expect(comments()).toHaveAttribute('aria-pressed', 'false');
  // Nothing was asked of Mobius.
  expect(model!.requests).toHaveLength(0);
});

test('a comment on a mail message goes to Mobius with the message, and the reply comes back into the thread', async () => {
  const RUI = 'From: Rui Almeida <rui@example.com>\r\nTo: Ana <ana@example.com>\r\nSubject: Terrace for the 13th\r\nMessage-ID: <t1@example.com>\r\nDate: Sun, 08 Nov 2026 09:02:00 +0000\r\n\r\nI can hold the terrace for eight on the 13th. Could you send the headcount by Wednesday?\r\n';
  servers = await startMailServers('app-pass', [{ uid: 7, flags: '', raw: RUI }]);
  await start([says(['Eight people, by Wednesday. I would reply to confirm.'])]);
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
  const list = shell().locator('.mail-page').getByRole('listbox', { name: 'Messages' });
  await list.getByRole('option').first().click();
  const message = shell().locator('.mail-page').getByRole('article');
  await expect(message).toContainText('hold the terrace');

  await shell().locator('body').press('c');
  await expect(comments()).toHaveAttribute('aria-pressed', 'true');
  await message.click({ position: { x: 40, y: 120 } });
  await shell().getByRole('dialog', { name: 'New comment' }).getByRole('textbox', { name: 'Comment' }).fill('What do they need from me?');
  await shell().getByRole('dialog', { name: 'New comment' }).getByRole('textbox', { name: 'Comment' }).press('Enter');
  const card = shell().getByRole('dialog', { name: 'Comment on Terrace for the 13th' });
  await card.getByRole('button', { name: 'Send to Mobius' }).click();
  await expect(card).toContainText('Eight people, by Wednesday');
  const sent = JSON.stringify(model!.requests[0]!.messages);
  expect(sent).toContain('What do they need from me?');
  expect(sent).toContain('hold the terrace for eight');
  await expect(shell().getByRole('button', { name: /^Comment on Terrace for the 13th/ })).toHaveAttribute('data-state', 'sent');
  // Resolve it; it can be reopened.
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(shell().getByRole('button', { name: /^Comment on Terrace for the 13th/ })).toHaveAttribute('data-state', 'resolved');
  await expect(card.getByRole('button', { name: 'Reopen' })).toBeVisible();
});
