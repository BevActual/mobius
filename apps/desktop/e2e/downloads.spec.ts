import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
let folder: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-downloads-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
  fs.rmSync(folder, { recursive: true, force: true });
});

const list = (): Locator => mobius!.shell.getByRole('region', { name: 'Downloads' });
/** Downloads open from a button in the sidebar's head; a new one opens them by itself, and this opens them otherwise. */
const shown = async (): Promise<Locator> => {
  const button = mobius!.shell.getByRole('button', { name: 'Downloads', exact: true });
  await expect(button).toBeVisible();
  await expect(async () => {
    if (!(await list().isVisible())) await button.click();
    await expect(list()).toBeVisible({ timeout: 1000 });
  }).toPass();
  return list();
};
const go = async (route: string) => {
  const address = mobius!.shell.getByRole('textbox', { name: 'Address or question' });
  await address.fill(fixture.origin + route);
  await address.press('Enter');
};

test('a download is saved to the folder, listed, and can be shown', async () => {
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_DOWNLOADS_DIR: folder } });
  await expect(list()).toHaveCount(0);
  await go('/file.txt');
  const item = (await shown()).getByRole('listitem').first();
  await expect(item).toContainText('file.txt');
  await expect(item).toContainText('Done');
  expect(fs.readFileSync(path.join(folder, 'file.txt'), 'utf8')).toBe('hello download');
  await expect(item.getByRole('button', { name: 'Open file.txt' })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Show file.txt in folder' })).toBeVisible();
  await expect(mobius.shell.locator('.tab-title')).toHaveText('Fixture home');
});

test('a second download of the same name does not overwrite the first', async () => {
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_DOWNLOADS_DIR: folder } });
  await go('/file.txt');
  await expect((await shown()).getByRole('listitem')).toHaveCount(1);
  await go('/file.txt?again');
  await expect((await shown()).getByRole('listitem')).toHaveCount(2);
  await expect(list()).toContainText('file (1).txt');
  // The file is only complete once both entries say so.
  await expect(list().getByText('Done')).toHaveCount(2);
  expect(fs.readdirSync(folder).sort()).toEqual(['file (1).txt', 'file.txt']);
});

test('a file that could run a program is saved but cannot be opened from here', async () => {
  // WebView2 holds a file that can run a program until someone presses Keep in its own download prompt, which a test
  // cannot reach. Mobius leaves those to that prompt (so a person can keep the file); the list follows it.
  // The system web view is the engine unless MOBIUS_ENGINE asks for Chromium (a build with the cef feature).
  test.fixme((process.env.MOBIUS_ENGINE ?? 'webview') === 'webview', 'WebView2 holds executable downloads open');
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_DOWNLOADS_DIR: folder } });
  await go('/setup.exe');
  const item = (await shown()).getByRole('listitem').first();
  await expect(item).toContainText('can run programs');
  await expect(item.getByRole('button', { name: /^Open/ })).toHaveCount(0);
  await expect(item.getByRole('button', { name: 'Show setup.exe in folder' })).toBeVisible();
  expect(fs.existsSync(path.join(folder, 'setup.exe'))).toBe(true);
});

test('a running download can be cancelled, and clearing forgets the finished ones', async () => {
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_DOWNLOADS_DIR: folder } });
  await go('/file.txt');
  await expect(await shown()).toContainText('Done');
  await go('/slow.bin');
  const slow = (await shown()).getByRole('listitem').filter({ hasText: 'slow.bin' });
  await expect(slow.getByRole('button', { name: 'Cancel slow.bin' })).toBeVisible();
  await slow.getByRole('button', { name: 'Cancel slow.bin' }).click();
  await expect(slow).toContainText('Cancelled');
  await list().getByRole('button', { name: 'Clear' }).click();
  await expect(list()).toHaveCount(0);
  expect(fs.existsSync(path.join(folder, 'file.txt'))).toBe(true);
});
