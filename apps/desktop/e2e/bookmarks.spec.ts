import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched } from './harness';

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
const star = () => shell().getByRole('button', { name: /^(Bookmark this page|Remove bookmark)$/ });
const openBookmarks = async () => {
  await shell().getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settings()).toBeVisible();
  await settings().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true }).click();
  await settings().getByRole('tab', { name: 'Bookmarks', exact: true }).click();
};
const saved = (): Locator => settings().getByRole('list', { name: 'Bookmarks' }).getByRole('listitem');

test('the star saves the open page, shows that it is saved, and removes it', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(star()).toHaveAccessibleName('Bookmark this page');
  await star().click();
  await expect(star()).toHaveAccessibleName('Remove bookmark');
  await expect(star()).toHaveAttribute('aria-pressed', 'true');
  await visit('/second', 'Second page');
  await expect(star()).toHaveAccessibleName('Bookmark this page');
  await shell().getByRole('textbox', { name: 'Address or question' }).fill(fixture.origin + '/');
  await shell().keyboard.press('Enter');
  await expect(star()).toHaveAccessibleName('Remove bookmark');
  await star().click();
  await expect(star()).toHaveAccessibleName('Bookmark this page');
});

test('pages that are not on the web cannot be bookmarked', async () => {
  mobius = await launch('about:blank');
  await expect(star()).toBeDisabled();
});

test('saved pages are listed in settings, can be searched and removed, and survive a restart', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-bm-'));
  try {
    mobius = await launch(fixture.origin + '/', { userData });
    await star().click();
    await visit('/second', 'Second page');
    await star().click();
    await expect(star()).toHaveAccessibleName('Remove bookmark');
    await openBookmarks();
    await expect(saved()).toHaveCount(2);
    await settings().getByRole('searchbox', { name: 'Search bookmarks' }).fill('second');
    await expect(saved()).toHaveCount(1);
    await settings().getByRole('searchbox', { name: 'Search bookmarks' }).fill('');
    await mobius.close({ keepUserData: true });
    mobius = await launch(fixture.origin + '/', { userData });
    await openBookmarks();
    await expect(saved()).toHaveCount(2);
    await settings().getByRole('button', { name: 'Remove bookmark Second page' }).click();
    await expect(saved()).toHaveCount(1);
    await settings().getByRole('button', { name: /Remove bookmark Fixture home/ }).click();
    await expect(settings().getByText(/No bookmarks yet/)).toBeVisible();
  } finally {
    await mobius?.close();
    mobius = undefined;
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
