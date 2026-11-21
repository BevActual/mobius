import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, removeTestData, resizeWindow, startFixture, type Fixture, type Launched } from './harness';
import { startMailServers, type MailFixture } from './mail-fixture';

// Ctrl+N makes something new in whichever app is open, with the cursor where you type next. It stopped working in every
// app once (after the panel redesign) and no test noticed, so this presses it in each of the default apps.
test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Checked on the Tauri shell');

let fixture: Fixture;
let servers: MailFixture;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  servers = await startMailServers('app-pass', []);
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-new-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await servers.close();
  await fixture.close();
  removeTestData(userData);
});

async function open(shell: Page, name: string): Promise<void> {
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
  await shell.keyboard.press('Enter');
  await expect(shell.locator('.strip-left .go-button')).toHaveAccessibleName(new RegExp(`^${name}\\.`));
}

test('Ctrl+N starts something new in each default app, ready to type in', async () => {
  mobius = await launch(fixture.origin + '/', { userData });
  const shell = mobius.shell;
  // Wide enough for Mail's and Calendar's panels, which start hidden in a narrow window.
  await resizeWindow(mobius.app, 1440, 900);

  await open(shell, 'Notes');
  await shell.keyboard.press('Control+n');
  await expect(shell.getByRole('textbox', { name: 'Note text' })).toBeFocused();

  await open(shell, 'Docs');
  await shell.keyboard.press('Control+n');
  await expect(shell.getByRole('textbox', { name: 'Document text' })).toBeFocused();

  await open(shell, 'Tasks');
  await shell.keyboard.press('Control+n');
  await expect(shell.getByRole('textbox', { name: 'List name' })).toBeFocused();
  await shell.keyboard.press('Escape');

  await open(shell, 'Calendar');
  await shell.keyboard.press('Control+n');
  await expect(shell.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await shell.keyboard.press('Escape');

  // Mail writes a new message once there is an account to send from.
  await open(shell, 'Mail');
  await shell.getByRole('button', { name: 'Add a mail account…' }).click();
  const dialog = shell.getByRole('dialog', { name: 'Add a mail account' });
  await dialog.getByRole('combobox', { name: 'Provider' }).selectOption('other');
  await dialog.getByRole('textbox', { name: 'Email address' }).fill('ana@example.com');
  await dialog.getByRole('textbox', { name: 'Incoming server (IMAP)' }).fill(`127.0.0.1:${servers.imapPort}`);
  await dialog.getByRole('textbox', { name: 'Outgoing server (SMTP)' }).fill(`127.0.0.1:${servers.smtpPort}`);
  await dialog.getByLabel('App password').fill('app-pass');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog).toHaveCount(0);
  await shell.keyboard.press('Control+n');
  await expect(shell.getByRole('combobox', { name: 'To' })).toBeFocused();
});
