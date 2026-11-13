import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { startMailServers, type MailFixture } from './mail-fixture';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let servers: MailFixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
const RUI = 'From: Rui Almeida <rui@example.com>\r\nTo: Ana <ana@example.com>\r\nSubject: Terrace + lunch for the 13th\r\nMessage-ID: <t1@example.com>\r\nDate: Sun, 08 Nov 2026 09:02:00 +0000\r\n\r\nHi!\r\n\r\nI can hold the terrace for eight on the 13th. Could you send the headcount by Wednesday?\r\n\r\nRui\r\n';
const TAP = 'From: TAP <noreply@flytap.com>\r\nSubject: Your booking LX7Q2M\r\nDate: Thu, 05 Nov 2026 18:10:00 +0000\r\nContent-Type: text/html\r\n\r\n<p>Your booking is confirmed.</p><img src="https://tracker.example/pixel.gif">\r\n';

test.beforeEach(async () => {
  fixture = await startFixture();
  servers = await startMailServers('app-pass', [{ uid: 7, flags: '', raw: RUI }, { uid: 8, flags: '\\Seen', raw: TAP }]);
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-mail-'));
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

const shell = () => mobius!.shell;
/** The message's id, as the app wrote it in its request to the model. */
const ID = '{{request:with id ([0-9a-f]{8}/inbox/[0-9]+)}}';
const page = (): Locator => shell().locator('.mail-page');

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Mail');
  await shell().keyboard.press('Enter');
  await expect(page()).toBeVisible();
  await shell().getByRole('button', { name: 'Add a mail account…' }).click();
  const dialog = shell().getByRole('dialog', { name: 'Add a mail account' });
  await dialog.getByRole('combobox', { name: 'Provider' }).selectOption('other');
  await dialog.getByRole('textbox', { name: 'Email address' }).fill('ana@example.com');
  await dialog.getByRole('textbox', { name: 'Incoming server (IMAP)' }).fill(`127.0.0.1:${servers.imapPort}`);
  await dialog.getByRole('textbox', { name: 'Outgoing server (SMTP)' }).fill(`127.0.0.1:${servers.smtpPort}`);
  await dialog.getByLabel('App password').fill('wrong');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByRole('alert')).toContainText('app password');
  await dialog.getByLabel('App password').fill('app-pass');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog).toHaveCount(0);
}

test('an account signs in with an app password, mail is sorted here, and only the person sends a reply', async () => {
  await start();
  const list = page().getByRole('listbox', { name: 'Messages' });
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option').first()).toContainText('Terrace + lunch for the 13th');
  await page().getByRole('tab', { name: /^Transactions/ }).click();
  await expect(list.getByRole('option').first()).toContainText('Your booking LX7Q2M');
  await list.getByRole('option').first().click();
  // The HTML is shown without loading anything from the web.
  const frame = page().locator('iframe.mail-html');
  await expect(frame).toBeVisible();
  expect(await frame.getAttribute('sandbox')).toBe('allow-same-origin');
  expect(await frame.getAttribute('srcdoc')).toContain("default-src 'none'");

  await page().getByRole('tab', { name: /^Primary/ }).click();
  await list.getByRole('option').first().click();
  await expect(page().getByRole('article')).toContainText('hold the terrace for eight');
  await shell().getByRole('toolbar', { name: 'Message' }).getByRole('button', { name: 'Reply', exact: true }).click();
  const compose = page().getByRole('form', { name: 'Reply' });
  await expect(compose.getByRole('textbox', { name: 'To' })).toHaveValue('rui@example.com');
  await expect(compose.getByRole('textbox', { name: 'Subject' })).toHaveValue('Re: Terrace + lunch for the 13th');
  await compose.getByRole('textbox', { name: 'Message' }).fill('Hi Rui, please hold it. We are 8.');
  await compose.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(compose).toHaveCount(0);
  await expect.poll(() => servers.sent.length).toBe(1);
  expect(servers.sent[0]).toContain('In-Reply-To: <t1@example.com>');
  expect(servers.sent[0]).toContain('Hi Rui, please hold it. We are 8.');
});

test('Mobius drafts a reply without sending it; the person opens it as a draft and sends it', async () => {
  await start([
    callsTool('mail-read', { id: ID }),
    callsTool('mail-draft', { replyTo: ID, body: 'Hi Rui, please hold it. We are 8, two vegetarians.', why: 'Sends the headcount he asked for.' }),
    says(['I drafted a reply for you to check.']),
  ]);
  const list = page().getByRole('listbox', { name: 'Messages' });
  await list.getByRole('option').first().click();
  await page().getByRole('button', { name: 'Draft a reply with Mobius' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: mail.read' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toHaveText('I drafted a reply for you to check.');
  await expect(log.getByRole('group', { name: 'Approval needed: mail.draft' })).toHaveCount(0);
  const suggested = page().getByLabel('Suggested reply');
  await expect(suggested).toContainText('two vegetarians');
  await expect(suggested).toContainText('Mobius never sends. You press Send.');
  expect(servers.sent.length).toBe(0);
  // Keep opens it as your draft.
  await suggested.getByRole('button', { name: 'Keep' }).click();
  await page().getByRole('form', { name: 'Reply' }).getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => servers.sent.length).toBe(1);
  expect(servers.sent[0]).toContain('two vegetarians');
});

test('the message toolbar: Reply All quotes the message, Flag files it under Flagged, Archive under Archive and back', async () => {
  await start();
  const list = page().getByRole('listbox', { name: 'Messages' });
  const tools = shell().getByRole('toolbar', { name: 'Message' });
  const boxes = shell().getByRole('region', { name: 'Mailboxes' });
  await list.getByRole('option').first().click();
  // Reply All starts above the quoted message, with the cursor there.
  await tools.getByRole('button', { name: 'Reply All' }).click();
  const compose = page().getByRole('form', { name: 'Reply' });
  await expect(compose.getByRole('textbox', { name: 'To' })).toHaveValue('rui@example.com');
  const body = compose.getByRole('textbox', { name: 'Message' });
  await expect(body).toBeFocused();
  await expect(body).toHaveValue(/Rui Almeida <rui@example.com> wrote:\n> Hi!/);
  await compose.getByRole('button', { name: 'Close' }).click();
  await list.getByRole('option').first().click();
  // Forward carries the message, with no one to send it to yet.
  await tools.getByRole('button', { name: 'Forward' }).click();
  const forward = page().getByRole('form', { name: 'New message' });
  await expect(forward.getByRole('textbox', { name: 'Subject' })).toHaveValue('Fwd: Terrace + lunch for the 13th');
  await expect(forward.getByRole('textbox', { name: 'Message' })).toHaveValue(/Begin forwarded message:/);
  await expect(forward.getByRole('textbox', { name: 'To' })).toBeFocused();
  await forward.getByRole('button', { name: 'Close' }).click();

  await list.getByRole('option').first().click();
  await tools.getByRole('button', { name: 'Flag' }).click();
  await expect(tools.getByRole('button', { name: 'Unflag' })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByRole('option').first().getByRole('img', { name: 'Flagged' })).toBeVisible();
  await expect.poll(() => servers.commands).toContain('UID STORE 7 +FLAGS.SILENT (\\Flagged)');
  await boxes.getByRole('button', { name: 'Flagged' }).click();
  await expect(list.getByRole('option')).toHaveCount(1);

  await boxes.getByRole('button', { name: 'Inbox' }).click();
  await list.getByRole('option').first().click();
  await tools.getByRole('button', { name: 'Archive' }).click();
  await expect(list.getByRole('option')).toHaveCount(0);
  // The shared Undo toast takes it back.
  await page().getByRole('status').filter({ hasText: 'Archived “Terrace + lunch for the 13th”' }).getByRole('button', { name: 'Undo' }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.getByRole('option').first().click();
  await tools.getByRole('button', { name: 'Archive' }).click();
  await expect(list.getByRole('option')).toHaveCount(0);
  await boxes.getByRole('button', { name: 'Archive' }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.getByRole('option').first().click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Move to Inbox' }).click();
  await expect(list.getByRole('option')).toHaveCount(0);
  await boxes.getByRole('button', { name: 'Inbox' }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
});
