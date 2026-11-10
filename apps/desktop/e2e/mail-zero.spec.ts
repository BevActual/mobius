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
const TAP = 'From: TAP <noreply@flytap.com>\r\nSubject: Your booking LX7Q2M\r\nDate: Thu, 05 Nov 2026 18:10:00 +0000\r\nContent-Type: text/html\r\n\r\n<p>Your booking is confirmed.</p>\r\n';

test.beforeEach(async () => {
  fixture = await startFixture();
  servers = await startMailServers('app-pass', [{ uid: 7, flags: '', raw: RUI }, { uid: 8, flags: '\\Seen', raw: TAP }]);
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-mailzero-'));
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
const page = (): Locator => shell().locator('.mail-page');
const inbox = () => page().getByRole('listbox', { name: 'Messages' });
const todos = () => path.join(userData, 'workspace', 'tasks', 'From mail.md');

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
  await dialog.getByLabel('App password').fill('app-pass');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog).toHaveCount(0);
  await page().getByRole('tab', { name: /^All/ }).click();
  await expect(inbox().getByRole('option')).toHaveCount(2);
}

test('Get to zero is a plan in the Mobius panel: keep it and the inbox empties, Undo all puts it back', async () => {
  await start();
  const zero = shell().getByRole('region', { name: 'Get to zero' });
  await zero.getByRole('button', { name: 'Get to zero' }).click();
  const plan = zero.getByRole('group', { name: 'Mobius’s plan' });
  await expect(plan).toHaveAttribute('data-proposed');
  await expect(plan.getByRole('button', { name: /^Archive/ })).toHaveText('Archive1');
  await expect(plan.getByRole('button', { name: /^To-dos/ })).toHaveText('To-dos1');
  await plan.getByRole('button', { name: /^To-dos/ }).click();
  await expect(plan.getByRole('list', { name: 'To-dos' })).toContainText('Terrace + lunch for the 13th');
  await plan.getByRole('button', { name: 'Keep the plan' }).click();
  await expect(zero.getByRole('status')).toContainText('Kept the plan');
  await expect(inbox().getByRole('option')).toHaveCount(0);
  await expect.poll(() => fs.existsSync(todos()) && fs.readFileSync(todos(), 'utf8')).toContain('Terrace + lunch for the 13th (Rui Almeida)');
  await zero.getByRole('button', { name: 'Undo all' }).click();
  await expect(inbox().getByRole('option')).toHaveCount(2);
  await expect.poll(() => fs.readFileSync(todos(), 'utf8')).not.toContain('Terrace');
  // Discard plan leaves everything as it was.
  await zero.getByRole('button', { name: 'Get to zero' }).click();
  await zero.getByRole('button', { name: 'Discard plan' }).click();
  await expect(inbox().getByRole('option')).toHaveCount(2);
});

test('the keys are shown under the list; E archives and H puts off the open message', async () => {
  await start();
  await expect(page().getByLabel('Keyboard')).toHaveText('E ArchiveR ReplyH Remind meCtrl+K Anything');
  await inbox().getByRole('option').filter({ hasText: 'Your booking' }).click();
  await page().locator('.mail-reader').click();
  await shell().keyboard.press('e');
  await expect(inbox().getByRole('option')).toHaveCount(1);
  await inbox().getByRole('option').first().click();
  await page().locator('.mail-reader').click();
  await shell().keyboard.press('h');
  await expect(inbox().getByRole('option')).toHaveCount(0);
});

test('Send later on a kept draft: Scheduled by you, and Unschedule', async () => {
  await start();
  await inbox().getByRole('option').filter({ hasText: 'Terrace' }).click();
  await page().getByRole('button', { name: 'Reply', exact: true }).click();
  const reply = page().getByRole('form', { name: 'Reply' });
  await reply.getByRole('textbox', { name: 'Message' }).fill('We are 8.');
  await reply.getByRole('textbox', { name: 'Subject' }).click();
  await reply.getByRole('button', { name: 'Send later' }).click();
  const menu = reply.getByRole('group', { name: 'Send later' });
  await expect(menu.getByRole('button', { name: 'Monday 9:00' })).toBeVisible();
  await menu.getByRole('button', { name: 'Tomorrow 8:00' }).click();
  await expect(reply.getByRole('status')).toContainText('Scheduled by you for');
  await reply.getByRole('button', { name: 'Unschedule' }).click();
  await expect(reply.getByRole('status')).toHaveCount(0);
});

test('Ask your mail answers in the panel with the messages it came from, each opening that mail', async () => {
  await start([
    callsTool('mail-search', { query: 'terrace' }),
    callsTool('mail-read', { id: '{{request:([0-9a-f]{8}/inbox/7)}}' }),
    says(['Rui can hold the terrace for eight on the 13th.']),
  ]);
  await shell().getByRole('textbox', { name: 'Ask your mail' }).fill('what did Rui say about the terrace?');
  await shell().getByRole('textbox', { name: 'Ask your mail' }).press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  for (const tool of ['mail.search', 'mail.read']) {
    const card = log.getByRole('group', { name: `Approval needed: ${tool}` });
    if (await card.waitFor({ timeout: 4000 }).then(() => true, () => false)) await card.getByRole('button', { name: 'Allow once' }).click();
  }
  await expect(log.locator('.msg.assistant')).toContainText('Rui can hold the terrace');
  const sources = log.getByRole('list', { name: 'From your mail' });
  await expect(sources.getByRole('button')).toHaveText(['Rui AlmeidaTerrace + lunch for the 13th']);
  await sources.getByRole('button').click();
  await expect(page().locator('.mail-reader')).toContainText('I can hold the terrace');
});
