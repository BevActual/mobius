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
  // The edge can be seen: a small grip at rest, and it says while it is held.
  expect(await handle.evaluate((e) => getComputedStyle(e, '::after').height)).toBe('32px');
  await shell().mouse.move(x + 60, y, { steps: 6 });
  await expect(handle).toHaveAttribute('data-dragging', 'true');
  await shell().mouse.up();
  await expect(handle).not.toHaveAttribute('data-dragging');
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
  await agentPanel().getByRole('menuitem', { name: 'Float Mobius' }).click();
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
  const handle = shell().getByRole('separator', { name: 'Resize Mobius' });
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
  await expect(shell().getByRole('separator', { name: 'Resize Mobius' })).toHaveAttribute('aria-valuenow', '500');

  await openSettings(shell());
  const page = shell().getByRole('region', { name: 'Settings' });
  await expect(page).toBeVisible();
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.locator('.settings-group[aria-label="Layout"]').scrollIntoViewIfNeeded();
  await expect(page.getByText('Now: 500 px.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset size' }).click();
  await expect.poll(async () => (await appearance()).rightWidth).toBe(340);
});

test('a width the window sends that is out of range is refused', async () => {
  const after = await setAppearance({ rightWidth: 5000 });
  expect((after as { rightWidth: number }).rightWidth).toBe(340);
});

test('a section header folds what follows it, by click or key, and the fold is kept', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  const header = tabs().getByRole('button', { name: 'Today', exact: true });
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  const body = tabs().locator('[data-fold-body]').first();
  await expect(body).toBeVisible();
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();
  expect(await shell().evaluate(() => window.localStorage.getItem('mobius.sidebar.folded'))).toContain('Tabs/Today');
  await header.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toBeVisible();
});

test('the Mobius panel starts closed, and its button opens it beside the work', async () => {
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData: mobius!.userData, openMobius: false });
  const show = shell().getByRole('button', { name: 'Show Mobius', exact: true });
  await expect(show).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 });
  await expect(shell().locator('.dock.right > .chat')).toHaveCount(0);
  await show.click();
  // These tests set up no model, so the panel opens on the model choice rather than the message box.
  await expect(shell().locator('.dock.right > .chat')).toBeVisible();
  await expect(shell().getByRole('button', { name: 'Hide Mobius', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a panel moves to another dock from its header\'s menu or by dragging its header, and stays there', async () => {
  await goTo(shell(), 'Tasks');
  const lists = (dock: string) => shell().locator(`.ui-dock[data-dock="${dock}"] section[aria-label="Lists"]`);
  await expect(lists('left')).toBeVisible();
  // Its header's menu (right-click, or the menu key) moves it.
  await lists('left').locator('.ui-panel-head').click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Move to the right' }).click();
  await expect(lists('right')).toBeVisible();
  await expect(lists('left')).toHaveCount(0);
  // Dragging its header near the page's left side moves it back; the docks it could go to show while it is held.
  const head = (await lists('right').locator('.ui-panel-head').boundingBox())!;
  const page = (await shell().locator('.ui-panels').boundingBox())!;
  await shell().mouse.move(head.x + 20, head.y + head.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(page.x + page.width / 2, page.y + page.height / 2, { steps: 4 });
  await expect(shell().locator('.ui-dock-target')).toHaveCount(2);
  await shell().mouse.move(page.x + 40, page.y + page.height / 2, { steps: 4 });
  await expect(shell().locator('.ui-dock-target[data-dock="left"][data-over]')).toHaveCount(1);
  await shell().mouse.up();
  await expect(shell().locator('.ui-dock-target')).toHaveCount(0);
  await expect(lists('left')).toBeVisible();
  // Escape while dragging leaves it where it was.
  const again = (await lists('left').locator('.ui-panel-head').boundingBox())!;
  await shell().mouse.move(again.x + 20, again.y + again.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(page.x + page.width - 40, page.y + page.height / 2, { steps: 6 });
  await shell().keyboard.press('Escape');
  await shell().mouse.up();
  await expect(lists('left')).toBeVisible();
  // The move is kept with the app's layout; Reset layout puts it back.
  await lists('left').locator('.ui-panel-head').click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Move to the bottom' }).click();
  await expect(lists('bottom')).toBeVisible();
  expect(await shell().evaluate(() => JSON.parse(localStorage.getItem('mobius.layout.tasks') ?? '{}').dock)).toEqual({ list: 'bottom' });
  // At the bottom it lays itself out for a short, wide place: its lists flow into columns, not rows the page's width.
  await expect(lists('bottom')).toHaveAttribute('data-shape', 'strip');
  const today = (await lists('bottom').getByRole('button', { name: 'Today', exact: true }).boundingBox())!;
  const inbox = (await lists('bottom').getByRole('button', { name: /^Inbox/ }).boundingBox())!;
  expect(inbox.x).toBeGreaterThan(today.x + today.width / 2);
  expect(today.width).toBeLessThan(400);
  // Each group stays whole, in one column under its heading.
  const logbook = (await lists('bottom').getByRole('button', { name: 'Logbook', exact: true }).boundingBox())!;
  expect(Math.round(logbook.x)).toBe(Math.round(today.x));
});

test('a panel pops out to float over the page, moves and sizes there, and docks again', async () => {
  await goTo(shell(), 'Tasks');
  const docked = shell().locator('.ui-dock[data-dock="left"] section[aria-label="Lists"]');
  const floating = shell().locator('.ui-float section[aria-label="Lists"]');
  await expect(docked).toBeVisible();
  await docked.locator('.ui-panel-head').click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Pop out' }).click();
  await expect(floating).toBeVisible();
  await expect(docked).toHaveCount(0);
  // The window's menus open over it, never under it.
  await shell().getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'View', exact: true }).click();
  const menu = shell().getByRole('menu', { name: 'View' });
  const box = (await menu.boundingBox())!;
  const over = (await shell().locator('.ui-float').boundingBox())!;
  const x = Math.max(box.x, over.x) + 4, y = Math.max(box.y, over.y) + 4;
  expect(x < box.x + box.width && y < box.y + box.height && x < over.x + over.width && y < over.y + over.height).toBe(true);
  expect(await shell().evaluate(([px, py]) => Boolean(document.elementFromPoint(px!, py!)?.closest('[role="menu"]')), [x, y])).toBe(true);
  await shell().keyboard.press('Escape');
  // Its header moves it, its corner sizes it, and both are kept.
  const card = shell().locator('.ui-float');
  const before = (await card.boundingBox())!;
  const head = (await floating.locator('.ui-panel-head').boundingBox())!;
  await shell().mouse.move(head.x + 30, head.y + head.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(head.x + 330, head.y + head.height / 2 + 60, { steps: 6 });
  await shell().mouse.up();
  await expect.poll(async () => Math.round((await card.boundingBox())!.x - before.x)).toBe(300);
  const moved = (await card.boundingBox())!;
  await shell().mouse.move(moved.x + moved.width - 4, moved.y + moved.height - 4);
  await shell().mouse.down();
  await shell().mouse.move(moved.x + moved.width + 76, moved.y + moved.height + 36, { steps: 6 });
  await shell().mouse.up();
  await expect.poll(async () => Math.round((await card.boundingBox())!.width - moved.width)).toBe(80);
  const kept = await shell().evaluate(() => JSON.parse(localStorage.getItem('mobius.layout.tasks') ?? '{}').float?.list);
  expect(kept).toMatchObject({ width: Math.round(moved.width + 80) });
  // Docked again from its menu.
  await floating.locator('.ui-panel-head').click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Dock on the left' }).click();
  await expect(docked).toBeVisible();
  await expect(card).toHaveCount(0);
  // Dragged from its dock and let go over the middle of the page, it floats there (once the dock has slid in).
  await expect(shell().locator('.ui-dock[data-dock="left"]')).not.toHaveAttribute('data-moving');
  const again = (await docked.locator('.ui-panel-head').boundingBox())!;
  const page = (await shell().locator('.ui-panels').boundingBox())!;
  await shell().mouse.move(again.x + 30, again.y + again.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(page.x + page.width / 2, page.y + page.height / 3, { steps: 6 });
  await shell().mouse.up();
  await expect(floating).toBeVisible();
});
