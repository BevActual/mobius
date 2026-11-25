import { expect, test } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  mobius = await launch(fixture.origin + '/');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
});

const shell = () => mobius!.shell;
const titles = () => shell().locator('.tab-title');
const address = () => shell().getByRole('textbox', { name: 'Address or question' });
const openIn = async (path: string) => {
  const before = await titles().count();
  await shell().getByTitle('New tab (Ctrl+T)').click();
  await expect(titles()).toHaveCount(before + 1);
  await address().fill(fixture.origin + path);
  await address().press('Enter');
};

test('the address bar shows the site at rest and the whole address to edit; Escape puts it back', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await expect(titles()).toHaveText(['Fixture home']);
  const host = new URL(fixture.origin).hostname;
  await expect(shell().locator('.address-rest')).toHaveText(host);
  await expect(address()).toHaveValue(fixture.origin + '/');
  await address().click();
  await expect(shell().locator('.address-rest')).toHaveCount(0);
  await address().fill('something else');
  await address().press('Escape');
  await expect(address()).toHaveValue(fixture.origin + '/');
  await address().press('Escape');
  await expect(address()).not.toBeFocused();
  await expect(shell().locator('.address-rest')).toHaveText(host);
});

test('a tab has a menu: pin it, then close the others', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await openIn('/');
  await expect(titles()).toHaveText(['Fixture home', 'Second page', 'Fixture home']);
  await shell().locator('.tab', { hasText: 'Second page' }).click({ button: 'right' });
  const menu = shell().getByRole('menu', { name: 'Second page' });
  await menu.getByRole('menuitem', { name: 'Pin tab' }).click();
  await expect(menu).toHaveCount(0);
  // Pinned tabs sit in their own list above Today, as in Arc.
  await expect(titles()).toHaveText(['Second page', 'Fixture home', 'Fixture home']);
  await expect(shell().getByRole('list', { name: 'Pinned tabs' }).locator('.tab-title')).toHaveText(['Second page']);
  await shell().locator('.tab', { hasText: 'Second page' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Close other tabs' }).click();
  // Pinned tabs stay; the other ordinary tabs go.
  await expect(titles()).toHaveText(['Second page']);
});

test('a middle click closes a tab', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().locator('.tab', { hasText: 'Fixture home' }).locator('.tab-main').click({ button: 'middle' });
  await expect(titles()).toHaveText(['Second page']);
});

test('Ctrl+Tab and Ctrl+Shift+Tab step through the tabs, going round', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  const current = () => shell().locator('.tab[aria-current="page"] .tab-title');
  await expect(current()).toHaveText('Second page');
  await shell().keyboard.press('Control+Tab');
  await expect(current()).toHaveText('Fixture home');
  await shell().keyboard.press('Control+Shift+Tab');
  await expect(current()).toHaveText('Second page');
});

test('Ctrl+H shows History in the tabs panel by day; a click goes there, a search narrows it, and Escape goes back to the tabs', { tag: '@shell', annotation: { type: 'needs the shell', description: 'pages visited are kept by the shell' } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().locator('.tab', { hasText: 'Second page' }).click();
  await shell().keyboard.press('Control+h');
  const today = shell().getByRole('list', { name: 'Visited today' });
  await expect(today.getByRole('button', { name: /Second page/ })).toBeVisible();
  await expect(today.getByRole('button', { name: /Fixture home/ })).toBeVisible();
  // A search narrows it to what has every word.
  await shell().getByRole('searchbox', { name: 'Search history' }).fill('second');
  await expect(today.getByRole('button')).toHaveCount(1);
  await shell().getByRole('searchbox', { name: 'Search history' }).fill('');
  // A click goes there in the tab that is open, as Chrome and Safari do.
  await today.getByRole('button', { name: /Fixture home/ }).click();
  await expect(address()).toHaveValue(fixture.origin + '/');
  // Escape goes back to the tabs: still two, the second now showing the home page.
  await shell().getByRole('searchbox', { name: 'Search history' }).press('Escape');
  await expect(titles()).toHaveText(['Fixture home', 'Fixture home']);
});
