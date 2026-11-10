import { expect, test, type Locator } from '@playwright/test';
import { launch, startFixture, views, type Fixture, type Launched, openSettings } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  mobius = await launch(fixture.origin + '/');
  await expect(shell().getByText('Core ready')).toBeVisible();
  // These tests are about the app's own list beside the page, which the narrow rail keeps separate.
  // Set once the window has read its own settings, which can land after this on a slow start: try until it holds.
  await expect(async () => {
    await shell().evaluate(() => window.mobius.appearance.set({ navigation: 'rail' }));
    await expect(shell().locator('.dock.left')).toHaveCount(1, { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  // The sidebar folds with a short animation: measure only once it has settled.
  await expect.poll(async () => Math.round((await shell().locator('.rail').boundingBox())!.width)).toBe(52);
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
});

const shell = () => mobius!.shell;
const tabs = (): Locator => shell().getByRole('complementary', { name: 'Browser sidebar' });
const agentPanel = (): Locator => shell().getByRole('complementary', { name: 'Agent' });
const left = (): Locator => shell().locator('.dock.left');
const right = (): Locator => shell().locator('.dock.right');
const appearance = () => shell().evaluate(() => window.mobius.appearance.get());
const setAppearance = (change: object) => shell().evaluate((c) => window.mobius.appearance.set(c), change);
const pageVisible = async () => (await views(mobius!.app)).some((v) => v.visible);
// Where the page starts, measured from the app rail (which is always there).
const leftEdge = async () => (await shell().locator('.stage').boundingBox())!.x - (await shell().locator('.rail').boundingBox())!.width;
const toggleTabs = () => shell().getByRole('button', { name: 'Show tabs' });

test('attached is how it starts: both sidebars are part of the layout', async () => {
  await expect(tabs()).toBeVisible();
  await expect(agentPanel()).toBeVisible();
  await expect(left()).not.toHaveAttribute('data-floating', /.*/);
  await expect(shell().getByTestId('hotzone-left')).toHaveCount(0);
  expect(await leftEdge()).toBeGreaterThan(200);
});

test('a floating list is out of the way until the pointer reaches the edge, covers the page while shown, and hides when left', async () => {
  await setAppearance({ leftSidebar: 'floating' });
  await expect(shell().getByTestId('hotzone-left')).toBeVisible();
  // It is put away, and the page has the room.
  await expect(tabs()).toHaveCount(0);
  expect(await leftEdge()).toBeLessThan(20);
  expect(await pageVisible()).toBe(true);

  const zone = (await shell().getByTestId('hotzone-left').boundingBox())!;
  await shell().mouse.move(zone.x + 3, zone.y + 100);
  await expect(tabs()).toBeVisible();
  await expect(left()).toHaveAttribute('data-floating', 'true');
  // The page is replaced by a picture of itself, so the list can be drawn over it.
  await expect.poll(pageVisible).toBe(false);
  expect(await leftEdge()).toBeLessThan(20);

  await shell().mouse.move(900, 400);
  await expect(tabs()).toHaveCount(0);
  await expect.poll(pageVisible).toBe(true);
});

test('a floating list can be opened with its button, and closes on Escape, on a click elsewhere, and on the button', async () => {
  await setAppearance({ leftSidebar: 'floating' });
  await expect(tabs()).toHaveCount(0);
  await toggleTabs().click();
  await expect(tabs()).toBeVisible();
  await tabs().getByRole('button', { name: 'New tab', exact: true }).focus();
  await shell().keyboard.press('Escape');
  await expect(tabs()).toHaveCount(0);

  await toggleTabs().click();
  await expect(tabs()).toBeVisible();
  await toggleTabs().click();
  await expect(tabs()).toHaveCount(0);

  await toggleTabs().click();
  await expect(tabs()).toBeVisible();
  await shell().locator('.context-strip').click({ position: { x: 4, y: 4 } });
  await expect(tabs()).toHaveCount(0);
  await expect.poll(pageVisible).toBe(true);
});

test('the pin button switches between floating and attached, and the choice is kept', async () => {
  await tabs().getByRole('button', { name: 'Float the list' }).click();
  await expect.poll(async () => (await appearance()).leftSidebar).toBe('floating');
  await expect(left()).toHaveAttribute('data-floating', 'true');
  await tabs().getByRole('button', { name: 'Attach the list' }).click();
  await expect.poll(async () => (await appearance()).leftSidebar).toBe('attached');
  await expect(left()).not.toHaveAttribute('data-floating', /.*/);
  expect(await leftEdge()).toBeGreaterThan(200);

  await agentPanel().getByRole('button', { name: 'Float the agent panel' }).click();
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

test('the conversation list in the Agent app floats and resizes the same way', async () => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
  await shell().keyboard.press('Enter');
  await expect(shell().getByRole('complementary', { name: 'Conversation list' })).toBeVisible();
  await shell().getByRole('complementary', { name: 'Conversation list' }).getByRole('button', { name: 'Float the list' }).click();
  await shell().keyboard.press('Escape');
  await shell().locator('.context-strip').click({ position: { x: 4, y: 4 } });
  await expect(shell().getByRole('complementary', { name: 'Conversation list' })).toHaveCount(0);
  await shell().getByRole('button', { name: 'Show conversations' }).click();
  await expect(shell().getByRole('complementary', { name: 'Conversation list' })).toBeVisible();
});

test('a sidebar can be dragged wider and narrower, within limits, and the width is kept', async () => {
  const handle = shell().getByRole('separator', { name: 'Resize the list' });
  await expect(handle).toHaveAttribute('aria-valuenow', '248');
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  await shell().mouse.move(x, y);
  await shell().mouse.down();
  await shell().mouse.move(x + 60, y, { steps: 6 });
  await expect(handle).toHaveAttribute('aria-valuenow', '308');
  await shell().mouse.up();
  await expect.poll(async () => (await appearance()).leftWidth).toBe(308);
  const wider = await leftEdge();

  const again = (await handle.boundingBox())!;
  await shell().mouse.move(again.x + 3, y);
  await shell().mouse.down();
  await shell().mouse.move(again.x + 3 + 900, y, { steps: 6 });
  await shell().mouse.up();
  await expect.poll(async () => (await appearance()).leftWidth).toBe(420);
  expect(await leftEdge()).toBeGreaterThan(wider);

  const third = (await handle.boundingBox())!;
  await shell().mouse.move(third.x + 3, y);
  await shell().mouse.down();
  await shell().mouse.move(third.x + 3 - 900, y, { steps: 6 });
  await shell().mouse.up();
  await expect.poll(async () => (await appearance()).leftWidth).toBe(200);
});

test('the agent panel grows when its edge is dragged left, the keys work, and a double-click puts the usual width back', async () => {
  const handle = shell().getByRole('separator', { name: 'Resize the agent panel' });
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
  const box = (await handle.boundingBox())!;
  await shell().mouse.move(box.x + 3, box.y + 200);
  await shell().mouse.down();
  await shell().mouse.move(box.x + 3 - 80, box.y + 200, { steps: 6 });
  await shell().mouse.up();
  await expect.poll(async () => (await appearance()).rightWidth).toBe(460);

  await handle.focus();
  await shell().keyboard.press('ArrowRight');
  await expect.poll(async () => (await appearance()).rightWidth).toBe(444);
  await shell().keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await appearance()).rightWidth).toBe(508);
  await shell().keyboard.press('Home');
  await expect.poll(async () => (await appearance()).rightWidth).toBe(300);
  await handle.dblclick();
  await expect.poll(async () => (await appearance()).rightWidth).toBe(380);
});

test('widths and modes survive a restart, and the settings page shows and resets them', async () => {
  await setAppearance({ leftWidth: 300, rightWidth: 500, leftSidebar: 'floating' });
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData: mobius!.userData });
  await expect.poll(async () => (await appearance()).leftWidth).toBe(300);
  await expect(left()).toHaveCount(0);
  await expect(shell().locator('.dock.right')).toBeVisible();
  await expect(shell().getByRole('separator', { name: 'Resize the agent panel' })).toHaveAttribute('aria-valuenow', '500');

  await openSettings(shell());
  const page = shell().getByRole('region', { name: 'Settings' });
  await expect(page).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Floating' }).first()).toBeChecked();
  await expect(page.getByText('list 300 px, agent panel 500 px')).toBeVisible();
  await page.getByRole('button', { name: 'Reset sizes' }).click();
  await expect.poll(async () => (await appearance()).leftWidth).toBe(248);
  expect((await appearance()).rightWidth).toBe(380);
});

test('a width the window sends that is out of range is refused', async () => {
  const after = await setAppearance({ leftWidth: 5000 });
  expect((after as { leftWidth: number }).leftWidth).toBe(248);
});
