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
  await shell().getByRole('button', { name: 'New tab' }).click();
  await expect(titles()).toHaveCount(before + 1);
  await address().fill(fixture.origin + path);
  await address().press('Enter');
};

test('the address bar shows the site at rest and the whole address to edit; Escape puts it back', async () => {
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

test('a tab has a menu: pin it, then close the others', async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await openIn('/');
  await expect(titles()).toHaveText(['Fixture home', 'Second page', 'Fixture home']);
  await shell().locator('.tab', { hasText: 'Second page' }).click({ button: 'right' });
  const menu = shell().getByRole('menu', { name: 'Second page' });
  await menu.getByRole('menuitem', { name: 'Pin tab' }).click();
  await expect(menu).toHaveCount(0);
  // Pinned tabs sit in their own list under the open tabs.
  await expect(titles()).toHaveText(['Fixture home', 'Fixture home', 'Second page']);
  await expect(shell().getByRole('list', { name: 'Pinned tabs' }).locator('.tab-title')).toHaveText(['Second page']);
  await shell().locator('.tab', { hasText: 'Second page' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Close other tabs' }).click();
  // Pinned tabs stay; the other ordinary tabs go.
  await expect(titles()).toHaveText(['Second page']);
});

test('a middle click closes a tab', async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().locator('.tab', { hasText: 'Fixture home' }).locator('.tab-main').click({ button: 'middle' });
  await expect(titles()).toHaveText(['Second page']);
});
