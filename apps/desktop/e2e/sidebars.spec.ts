import { expect, test, type Locator } from '@playwright/test';
import { goTo, goToPlace, launch, startFixture, views, type Fixture, type Launched, openSettings, resizeWindow } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  mobius = await launch(fixture.origin + '/');
  await expect(shell().getByText('Core ready')).toBeVisible();
  // These tests are about the app's own list beside the page, at the window's left edge (no rail).
  await expect(shell().locator('.ui-dock[data-dock="left"]')).toHaveCount(1, { timeout: 15_000 });
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
});

const shell = () => mobius!.shell;
const tabs = (): Locator => shell().getByRole('complementary', { name: 'Tabs' });
const agentPanel = (): Locator => shell().getByRole('complementary', { name: 'Agent', exact: true });
const left = (): Locator => shell().locator('.ui-dock[data-dock="left"]');
const right = (): Locator => shell().locator('.dock.right');
const appearance = () => shell().evaluate(() => window.mobius.appearance.get());
const setAppearance = (change: object) => shell().evaluate((c) => window.mobius.appearance.set(c), change);
const pageVisible = async () => (await views(mobius!.app)).some((v) => v.visible);
// Where the page starts, measured from the window's left edge.
const pageEdge = async () => (await shell().getByTestId('surface-slot').boundingBox())!.x;
// The native page sits on its slot, wherever the panels put the slot.
const pageOnSlot = async () => {
  const slot = (await shell().getByTestId('surface-slot').boundingBox())!;
  const view = (await views(mobius!.app)).find((v) => v.visible)!;
  return Math.max(...(['x', 'y', 'width', 'height'] as const).map((key) => Math.abs(view.bounds[key] - slot[key])));
};

test('the Browser keeps its tabs in a panel of its own on the left, and the page sits beside it', async () => {
  await expect(tabs()).toBeVisible();
  await expect(agentPanel()).toBeVisible();
  await expect(left().getByRole('region', { name: 'Tabs' })).toBeVisible();
  // The shell's own list, its pin and its edge zone are gone: the list is the app's.
  await expect(shell().locator('.dock.left')).toHaveCount(0);
  await expect(shell().getByTestId('hotzone-left')).toHaveCount(0);
  expect(await pageEdge()).toBeGreaterThanOrEqual(180);
  await expect.poll(pageOnSlot).toBeLessThanOrEqual(2);
  // Hidden, the page takes the room, and comes back beside it with Ctrl+\.
  await shell().getByRole('button', { name: 'Hide Tabs' }).click();
  await expect(tabs()).toHaveCount(0);
  expect(await pageEdge()).toBeLessThan(20);
  await expect.poll(pageOnSlot).toBeLessThanOrEqual(2);
  await shell().keyboard.press('Control+Backslash');
  await expect(tabs()).toBeVisible();
  await expect.poll(pageOnSlot).toBeLessThanOrEqual(2);
});

test('the tabs panel can be dragged wider, within limits, and the Browser keeps its width', async () => {
  await resizeWindow(mobius!.app, 1600, 900);
  const handle = shell().getByRole('separator', { name: 'Resize the panels on the left' });
  await expect(handle).toHaveAttribute('aria-valuenow', '248');
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  await shell().mouse.move(x, y);
  await shell().mouse.down();
  await shell().mouse.move(x + 60, y, { steps: 6 });
  await shell().mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '308');
  await expect.poll(pageOnSlot).toBeLessThanOrEqual(2);
  await shell().mouse.move(x + 60, y);
  await shell().mouse.down();
  await shell().mouse.move(x + 60 + 900, y, { steps: 6 });
  await shell().mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '480');
  await goTo(shell(), 'Notes');
  await goTo(shell(), 'Browser');
  await expect(shell().getByRole('separator', { name: 'Resize the panels on the left' })).toHaveAttribute('aria-valuenow', '480');
});

test('the agent panel can float, from its All chats menu, and the choice is kept', async () => {
  await agentPanel().getByRole('button', { name: 'All chats' }).click();
  await agentPanel().getByRole('menuitem', { name: 'Float the agent panel' }).click();
  await expect.poll(async () => (await appearance()).rightSidebar).toBe('floating');
  await expect(right()).toHaveAttribute('data-floating', 'true');
});

test('a floating agent panel appears from the right edge and hides again', async () => {
  await setAppearance({ rightSidebar: 'floating' });
  await expect(agentPanel()).toHaveCount(0);
  const stage = (await shell().locator('.stage').boundingBox())!;
  const width = await shell().evaluate(() => window.innerWidth);
  expect(stage.x + stage.width).toBeGreaterThan(width - 20);

  const zone = (await shell().getByTestId('hotzone-right').boundingBox())!;
  await shell().mouse.move(zone.x + 4, zone.y + 100);
  await expect(agentPanel()).toBeVisible();
  await expect.poll(pageVisible).toBe(false);
  // Back over the page, left of the panel (on a narrow window the middle of the page is under the floating panel).
  await shell().mouse.move(stage.x + 40, stage.y + stage.height / 2);
  await expect(agentPanel()).toHaveCount(0);
  await expect.poll(pageVisible).toBe(true);
});

test('Home keeps its chats in a panel of its own: on the left, hidden and shown again with Ctrl+\\, and kept that way', async () => {
  await goToPlace(shell(), 'Home');
  const chats = shell().getByRole('region', { name: 'Chats' });
  await expect(chats.getByRole('complementary', { name: 'Chats' })).toBeVisible();
  await expect(shell().locator('.dock.left')).toHaveCount(0);
  await shell().keyboard.press('Control+Backslash');
  await expect(chats).toHaveCount(0);
  await shell().keyboard.press('Control+Backslash');
  await expect(chats).toBeVisible();
  await chats.getByRole('button', { name: 'Hide Chats' }).click();
  await expect(chats).toHaveCount(0);
  await goTo(shell(), 'Notes');
  await goToPlace(shell(), 'Home');
  await expect(chats).toHaveCount(0);
});

test('the agent panel grows when its edge is dragged left, the keys work, and a double-click puts the usual width back', async () => {
  await resizeWindow(mobius!.app, 1600, 900);
  const handle = shell().getByRole('separator', { name: 'Resize the agent panel' });
  await expect(handle).toHaveAttribute('aria-valuenow', '340');
  const box = (await handle.boundingBox())!;
  await shell().mouse.move(box.x + 3, box.y + 200);
  await shell().mouse.down();
  await shell().mouse.move(box.x + 3 - 80, box.y + 200, { steps: 6 });
  await shell().mouse.up();
  await expect.poll(async () => (await appearance()).rightWidth).toBe(420);

  await handle.focus();
  await shell().keyboard.press('ArrowRight');
  await expect.poll(async () => (await appearance()).rightWidth).toBe(404);
  await shell().keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await appearance()).rightWidth).toBe(468);
  await shell().keyboard.press('Home');
  await expect.poll(async () => (await appearance()).rightWidth).toBe(300);
  await handle.dblclick();
  await expect.poll(async () => (await appearance()).rightWidth).toBe(340);
});

test('the agent panel’s width and mode survive a restart, and the settings page shows and resets the width', async () => {
  await setAppearance({ rightWidth: 500 });
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData: mobius!.userData });
  await resizeWindow(mobius.app, 1600, 900);
  await expect(shell().locator('.dock.right')).toBeVisible();
  await expect(shell().getByRole('separator', { name: 'Resize the agent panel' })).toHaveAttribute('aria-valuenow', '500');

  await openSettings(shell());
  const page = shell().getByRole('region', { name: 'Settings' });
  await expect(page).toBeVisible();
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByText('Now: 500 px.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset size' }).click();
  await expect.poll(async () => (await appearance()).rightWidth).toBe(340);
});

test('a width the window sends that is out of range is refused', async () => {
  const after = await setAppearance({ rightWidth: 5000 });
  expect((after as { rightWidth: number }).rightWidth).toBe(340);
});

test('a section header folds what follows it, by click or key, and the fold is kept', async () => {
  const header = tabs().getByRole('button', { name: 'Tabs', exact: true });
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  const body = tabs().locator('[data-fold-body]').first();
  await expect(body).toBeVisible();
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();
  expect(await shell().evaluate(() => window.localStorage.getItem('mobius.sidebar.folded'))).toContain('Browser sidebar/Tabs');
  await header.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toBeVisible();
});
