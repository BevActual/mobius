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

test('a closed tab is listed under Recently closed in History and opens again from there; Ctrl+Shift+C copies the address', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().locator('.tab', { hasText: 'Second page' }).click();
  // Ctrl+Shift+C copies the page's address and says so, as Arc's Copy URL.
  await shell().locator('.tab', { hasText: 'Second page' }).press('Control+Shift+c');
  await expect(shell().locator('.notice[role=status]')).toHaveText('Copied the link');
  await shell().getByRole('button', { name: 'Close Second page' }).click();
  await expect(titles()).toHaveText(['Fixture home']);
  await shell().keyboard.press('Control+h');
  const closed = shell().getByRole('list', { name: 'Recently closed' });
  await closed.getByRole('button', { name: /Second page/ }).click();
  await expect(closed).toHaveCount(0);
  await shell().keyboard.press('Control+h');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
});

test('split view shows two tabs side by side from the tab menu; the divider moves with the arrow keys and End split keeps one page', { tag: '@shell', annotation: { type: 'needs the shell', description: 'the native pages are placed by the shell' } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().locator('.tab', { hasText: 'Fixture home' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Open in split view' }).click();
  await expect(shell().getByTestId('surface-slot-beside')).toHaveCount(1);
  await expect(shell().locator('.browser-split-title')).toHaveText(['Second page', 'Fixture home']);
  await expect(shell().locator('.tab[data-split="true"]')).toHaveCount(2);
  // Both pages get real room: about half the page panel each, not a sliver.
  const halves = shell().locator('.browser-split-half');
  const [one, two] = [await halves.nth(0).boundingBox(), await halves.nth(1).boundingBox()];
  expect(one!.width).toBeGreaterThan(200);
  expect(Math.abs(one!.width - two!.width)).toBeLessThan(40);
  const divider = shell().getByRole('separator', { name: 'Resize split view' });
  await divider.focus();
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '45');
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '80');
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await shell().getByRole('button', { name: 'End split view, keep Second page' }).click();
  await expect(shell().getByTestId('surface-slot-beside')).toHaveCount(0);
  await expect(shell().locator('.tab[data-split="true"]')).toHaveCount(0);
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
});

test('a pinned folder holds tabs, opens and closes in place, and keeps its tabs pinned when deleted', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().locator('.tab', { hasText: 'Second page' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'New folder with tab' }).click();
  const name = shell().getByRole('textbox', { name: 'Folder name' });
  await name.fill('Reading');
  await name.press('Enter');
  const folder = shell().getByRole('button', { name: /^Reading/ });
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await expect(shell().getByRole('list', { name: 'Reading tabs' }).locator('.tab-title')).toHaveText(['Second page']);
  // Closed, a folder still shows the tab you are on, as Arc's; on another tab it hides its own.
  await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await expect(shell().getByRole('list', { name: 'Reading tabs' }).locator('.tab-title')).toHaveText(['Second page']);
  await shell().getByRole('list', { name: 'Open tabs' }).locator('.tab-main').first().click();
  await expect(shell().getByRole('list', { name: 'Reading tabs' })).toHaveCount(0);
  await folder.click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Delete folder' }).click();
  await expect(shell().getByRole('list', { name: 'Folders' })).toHaveCount(0);
  await expect(shell().getByRole('list', { name: 'Pinned tabs' }).locator('.tab-title')).toHaveText(['Second page']);
});

test('Ctrl+= zooms the page and the site keeps it in its other tabs; the readout resets it; a tab can be muted from its menu', { tag: '@shell', annotation: { type: 'needs the shell', description: 'page zoom and sound are the shell’s' } }, async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().locator('.tab', { hasText: 'Second page' }).locator('.tab-main').click();
  await shell().keyboard.press('Control+Equal');
  await expect(shell().locator('.notice[role=status]')).toHaveText('Zoom 110%');
  const readout = shell().getByRole('button', { name: 'Zoom 110%, reset to 100%' });
  await expect(readout).toBeVisible();
  // The same site in another tab opens at the same size, as Chrome's per-site zoom.
  await shell().locator('.tab', { hasText: 'Fixture home' }).locator('.tab-main').click();
  await expect(readout).toBeVisible();
  await readout.click();
  await expect(shell().locator('.address-zoom')).toHaveCount(0);
  await shell().locator('.tab', { hasText: 'Fixture home' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Mute tab' }).click();
  await shell().locator('.tab', { hasText: 'Fixture home' }).click({ button: 'right' });
  await expect(shell().getByRole('menuitem', { name: 'Unmute tab' })).toBeVisible();
  await shell().keyboard.press('Escape');
});
