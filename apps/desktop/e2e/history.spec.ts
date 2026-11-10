import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
});

const shell = () => mobius!.shell;
const settings = (): Locator => shell().getByRole('region', { name: 'Settings' });
const visit = async (route: string, title: string) => {
  const address = shell().getByRole('textbox', { name: 'Address or question' });
  await address.fill(fixture.origin + route);
  await address.press('Enter');
  await expect(shell().locator('.tab-title').first()).toHaveText(title);
};
const openHistory = async () => {
  await openSettings(shell());
  await expect(settings()).toBeVisible();
  await settings().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true }).click();
  await settings().getByRole('tab', { name: 'History', exact: true }).click();
};
const pages = (): Locator => settings().getByRole('list', { name: 'Pages you visited' }).getByRole('listitem');

test('pages you visit are listed, can be searched, removed and cleared', async () => {
  mobius = await launch(fixture.origin + '/');
  await visit('/second', 'Second page');
  await openHistory();
  await expect(pages().filter({ hasText: 'Second page' })).toHaveCount(1);
  await expect(pages().filter({ hasText: 'Fixture home' })).toHaveCount(1);
  await settings().getByRole('searchbox', { name: 'Search history' }).fill('second');
  await expect(pages()).toHaveCount(1);
  await settings().getByRole('searchbox', { name: 'Search history' }).fill('zzzz');
  await expect(settings().getByText('Nothing matches.')).toBeVisible();
  await settings().getByRole('searchbox', { name: 'Search history' }).fill('');
  await settings().getByRole('button', { name: 'Remove Second page from history' }).click();
  await expect(pages().filter({ hasText: 'Second page' })).toHaveCount(0);
  await settings().getByRole('button', { name: 'Clear all' }).click();
  await settings().getByRole('button', { name: 'Confirm clear' }).click();
  await expect(settings().getByText('No pages yet.')).toBeVisible();
});

test('turning history off stops recording, and the choice and the pages survive a restart', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-hist-'));
  try {
    mobius = await launch(fixture.origin + '/', { userData });
    await visit('/second', 'Second page');
    await openHistory();
    await expect(pages().filter({ hasText: 'Second page' })).toHaveCount(1);
    await settings().getByRole('switch', { name: /Off|On/ }).uncheck();
    await shell().keyboard.press('Escape');
    await visit('/icon', 'Icon page');
    await openHistory();
    await expect(pages().filter({ hasText: 'Icon page' })).toHaveCount(0);
    await mobius.close({ keepUserData: true });
    mobius = await launch(fixture.origin + '/', { userData });
    await openHistory();
    await expect(settings().getByRole('switch')).not.toBeChecked();
    await expect(pages().filter({ hasText: 'Second page' })).toHaveCount(1);
  } finally {
    await mobius?.close();
    mobius = undefined;
    removeTestData(userData);
  }
});

test('the settings search finds history', async () => {
  mobius = await launch(fixture.origin + '/');
  // A key pressed before the window has finished starting is not a shortcut yet.
  await expect(shell().getByRole('textbox', { name: 'Address or question' })).toBeVisible();
  await expect(shell().getByText('Core ready')).toBeVisible();
  await shell().keyboard.press('Control+,');
  await settings().getByRole('searchbox', { name: 'Search settings' }).fill('clear history');
  await settings().getByRole('button', { name: /Pages you visited/ }).first().click();
  await expect(settings().getByRole('searchbox', { name: 'Search history' })).toBeVisible();
});
