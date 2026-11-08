import { expect, test } from '@playwright/test';
import { expectVisibleView, launch, resizeWindow, runInPage, startFixture, views, type Fixture, type Launched } from './harness';

let fixture: Fixture;
let mobius: Launched;

test.beforeEach(async () => {
  fixture = await startFixture();
  mobius = await launch(fixture.origin + '/');
});
test.afterEach(async () => {
  await mobius.close();
  await fixture.close();
});

const address = () => mobius.shell.getByRole('textbox', { name: 'Address or question' });
const tabTitles = () => mobius.shell.locator('.tab-title');

test('opens one window with a single visible page glued to the slot', async () => {
  await expect(mobius.shell.locator('.strip-title')).toHaveText('Fixture home');
  const view = await expectVisibleView(mobius.app);
  expect(view.url).toBe(fixture.origin + '/');
  await expect(tabTitles()).toHaveText(['Fixture home']);
  await expect(address()).toHaveValue(fixture.origin + '/');
  const slot = (await mobius.shell.getByTestId('surface-slot').boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(view.bounds[key] - slot[key]), key).toBeLessThanOrEqual(2);
});

test('the page stays glued to the slot when the window resizes and the panel toggles', async () => {
  await expectVisibleView(mobius.app);
  await mobius.shell.evaluate(() => window.mobius.appearance.set({ navigation: 'rail' }));
  await resizeWindow(mobius.app, 1000, 700);
  await mobius.shell.getByRole('button', { name: 'Show tabs' }).click();
  await expect.poll(async () => {
    const slot = (await mobius.shell.getByTestId('surface-slot').boundingBox())!;
    const view = (await views(mobius.app)).find((v) => v.visible)!;
    return Math.max(...(['x', 'y', 'width', 'height'] as const).map((key) => Math.abs(view.bounds[key] - slot[key])));
  }).toBeLessThanOrEqual(2);
  await expect(mobius.shell.getByRole('complementary', { name: 'Browser sidebar' })).toHaveCount(0);
});

test('the address field navigates, and the tab list follows the page title', async () => {
  // Wait for the first page to finish loading, or the navigation below would replace it instead of following it.
  await expect(tabTitles()).toHaveText(['Fixture home']);
  await address().fill(fixture.origin.replace('http://', '') + '/second');
  await address().press('Enter');
  await expect(tabTitles()).toHaveText(['Second page']);
  await expect(mobius.shell.getByRole('button', { name: 'Back' })).toBeEnabled();
  await mobius.shell.getByRole('button', { name: 'Back' }).click();
  await expect(tabTitles()).toHaveText(['Fixture home']);
  await expect(mobius.shell.getByRole('button', { name: 'Forward' })).toBeEnabled();
});

test('questions are not navigated, and non-web schemes are refused', async () => {
  // Wait for the first page to finish loading, or its own request would be counted as a navigation below.
  await expect(tabTitles()).toHaveText(['Fixture home']);
  const before = fixture.hits.length;
  await address().fill('what is a webview');
  await address().press('Enter');
  await expect(mobius.shell.getByRole('status').filter({ hasText: 'to ask questions' })).toBeVisible();
  for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<b>x</b>', 'chrome://gpu']) {
    await address().fill(bad);
    await address().press('Enter');
    await expect(mobius.shell.getByRole('status').filter({ hasText: 'only opens web addresses' })).toBeVisible();
  }
  expect((await views(mobius.app))[0]!.url).toBe(fixture.origin + '/');
  expect(fixture.hits.length).toBe(before);
});

test('web pages cannot see Node, Electron, or the Mobius bridge', async () => {
  await address().fill(fixture.origin + '/probe');
  await address().press('Enter');
  await expect(tabTitles()).toHaveText(['probe:undefined,undefined,undefined,undefined,undefined']);
});

test('pages are denied every permission', async () => {
  await address().fill(fixture.origin + '/perm');
  await address().press('Enter');
  await expect(tabTitles()).toHaveText(['perm:denied']);
});

test('window.open becomes a new tab for web addresses only, and pages cannot navigate to files', async () => {
  const [first] = await views(mobius.app);
  await runInPage(mobius.app, first!.id, "window.open('/popup')");
  await expect(tabTitles()).toHaveText(['Fixture home', 'Popup page']);
  await runInPage(mobius.app, first!.id, "window.open('file:///C:/Windows/win.ini')");
  await runInPage(mobius.app, first!.id, "location.href = 'file:///C:/Windows/win.ini'");
  await new Promise((resolve) => setTimeout(resolve, 600));
  await expect(tabTitles()).toHaveText(['Fixture home', 'Popup page']);
  expect((await views(mobius.app)).find((v) => v.id === first!.id)!.url).toBe(fixture.origin + '/');
});

test('only the active tab is visible, and closing the last tab opens a fresh one', async () => {
  await mobius.shell.getByRole('button', { name: 'New tab' }).click();
  await expect(tabTitles()).toHaveCount(2);
  expect((await views(mobius.app)).filter((v) => v.visible)).toHaveLength(1);
  await mobius.shell.getByRole('button', { name: 'Close Fixture home' }).click();
  await expect(tabTitles()).toHaveCount(1);
  await mobius.shell.getByRole('button', { name: /^Close / }).click();
  await expect(tabTitles()).toHaveCount(1);
  // The page is placed again a moment after the list changes, so look until it is there.
  await expect.poll(async () => (await views(mobius.app)).filter((v) => v.visible).length).toBe(1);
});

test('the launcher hides the native page while open and returns focus on Escape', async () => {
  await expectVisibleView(mobius.app);
  const opener = mobius.shell.getByRole('textbox', { name: 'Address or question' });
  await opener.focus();
  await mobius.shell.keyboard.press('Control+K');
  const dialog = mobius.shell.getByRole('dialog', { name: 'Launcher' });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await views(mobius.app)).filter((v) => v.visible).length).toBe(0);
  await expect(mobius.shell.getByRole('combobox', { name: /Find apps/ })).toBeFocused();
  await mobius.shell.keyboard.type('canvas');
  await expect(mobius.shell.getByRole('option', { name: /Canvas/ })).toHaveAttribute('aria-disabled', 'true');
  await mobius.shell.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await views(mobius.app)).filter((v) => v.visible).length).toBe(1);
  await expect(opener).toBeFocused();
});

test('the launcher finds an open page and activates it', async () => {
  await mobius.shell.getByRole('button', { name: 'New tab' }).click();
  await expect(tabTitles()).toHaveCount(2);
  await mobius.shell.keyboard.press('Control+K');
  await mobius.shell.keyboard.type('fixture');
  await expect(mobius.shell.getByRole('option', { name: /Fixture home/ })).toBeVisible();
  await mobius.shell.keyboard.press('Enter');
  await expect(mobius.shell.getByRole('dialog', { name: 'Launcher' })).toBeHidden();
  await expect(mobius.shell.locator('.tab[aria-current="page"] .tab-title')).toHaveText('Fixture home');
});

test('the launcher finds menu commands by name, and offers to ask Mobius only once a model is set up', async () => {
  await mobius.shell.keyboard.press('Control+K');
  await mobius.shell.keyboard.type('split');
  await expect(mobius.shell.getByRole('option', { name: /^Split view/ })).toHaveAttribute('aria-selected', 'true');
  await expect(mobius.shell.getByRole('option', { name: /Ask Mobius/ })).toHaveCount(0);
  await mobius.shell.keyboard.press('Escape');
});
