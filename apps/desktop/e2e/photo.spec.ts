import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

// A 4 × 4 picture: sky on top, hills below.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAgMAAADUn3btAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURX+z5m+PTv///yURNH0AAAABYktHRAJmC3xkAAAAB3RJTUUH6gsICzIQNf0gTgAAABBJREFUCNdjYGBgYAhlCAUAAVwAq6n8OZAAAAAASUVORK5CYII=', 'base64');
const WARM = { version: 1, adjustments: [{ id: 'a1', name: 'Warm the hills', warmth: 40, area: { kind: 'below', at: 0.5, soft: 0.1 } }] };

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-photo-'));
  fs.mkdirSync(album(), { recursive: true });
  fs.writeFileSync(path.join(album(), 'coastline.png'), PNG);
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
function album() { return path.join(userData, 'workspace', 'photos', 'Lisbon'); }
const editsFile = () => path.join(album(), 'coastline.png.edits.json');
const panel = (): Locator => shell().getByRole('tabpanel', { name: 'Adjustments' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  // Wide enough for the photo, Adjust in the inspector and Mobius side by side (narrower, they take turns over the page).
  await resizeWindow(mobius.app, 1440, 900);
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Photo');
  await shell().keyboard.press('Enter');
  await expect(shell().getByRole('img', { name: 'The photo with edits' })).toBeVisible();
}

test('adjustments are kept beside the photo, which never changes, and Export saves a new picture', async () => {
  await start();
  // Adjust, from the toolbar, brings the inspector forward (in a narrow window it takes turns with Mobius).
  await shell().getByRole('tab', { name: 'Adjust', exact: true }).first().click();
  await panel().getByRole('button', { name: 'Add adjustment' }).click();
  await panel().getByRole('slider', { name: 'Warmth' }).fill('30');
  await panel().getByRole('combobox', { name: 'Applies to' }).selectOption('below');
  await expect.poll(() => fs.existsSync(editsFile()) && JSON.parse(fs.readFileSync(editsFile(), 'utf8')).adjustments[0]).toMatchObject({ warmth: 30, area: { kind: 'below' } });
  expect(fs.readFileSync(path.join(album(), 'coastline.png'))).toEqual(PNG);
  await panel().getByRole('button', { name: 'Hide Adjustment 1' }).click();
  await expect.poll(() => JSON.parse(fs.readFileSync(editsFile(), 'utf8')).adjustments[0].hidden).toBe(true);
  // Each section of sliders folds away and puts itself back with its own reset.
  await panel().getByRole('button', { name: 'Reset Color' }).click();
  await expect.poll(() => JSON.parse(fs.readFileSync(editsFile(), 'utf8')).adjustments[0].warmth ?? 0).toBe(0);
  await panel().getByRole('button', { name: 'Color', exact: true }).click();
  await expect(panel().getByRole('slider', { name: 'Warmth' })).toHaveCount(0);
  await panel().getByRole('button', { name: 'Color', exact: true }).click();

  await shell().getByRole('button', { name: 'Export' }).click();
  await expect(shell().getByRole('status').filter({ hasText: 'Saved as coastline edited.jpg' })).toBeVisible();
  expect(fs.readFileSync(path.join(album(), 'coastline edited.jpg')).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  // Escape goes back to the album, which now has the exported picture in it.
  // In a narrow window the inspector floats over the right of the page, so the photo is clicked at its corner.
  await shell().getByRole('img', { name: 'The photo with edits' }).click({ position: { x: 4, y: 4 } });
  await shell().keyboard.press('Escape');
  const grid = shell().getByRole('list', { name: 'Photos in Lisbon' });
  await expect(grid.getByRole('button', { name: 'coastline edited.jpg' })).toBeVisible();
  await grid.getByRole('button', { name: 'coastline.png' }).click();
  await expect(shell().getByRole('img', { name: 'The photo with edits' })).toBeVisible();
});

test('photos are renamed, moved and deleted with their edits, and come back from Recently Deleted', async () => {
  fs.writeFileSync(editsFile(), JSON.stringify(WARM));
  fs.mkdirSync(path.join(userData, 'workspace', 'photos', 'Porto'), { recursive: true });
  await start();
  await shell().getByRole('img', { name: 'The photo with edits' }).click();
  await shell().keyboard.press('Escape');
  const grid = shell().getByRole('list', { name: 'Photos in Lisbon' });
  await grid.getByRole('button', { name: 'coastline.png' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Rename' }).click();
  await shell().getByRole('textbox', { name: 'Photo name' }).fill('shore');
  await shell().keyboard.press('Enter');
  await expect(grid.getByRole('button', { name: 'shore.png' })).toBeVisible();
  expect(fs.existsSync(path.join(album(), 'shore.png.edits.json'))).toBe(true);

  await grid.getByRole('button', { name: 'shore.png' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Move to Porto' }).click();
  const porto = path.join(userData, 'workspace', 'photos', 'Porto');
  await expect.poll(() => fs.existsSync(path.join(porto, 'shore.png.edits.json'))).toBe(true);

  await shell().getByRole('region', { name: 'Albums' }).getByRole('button', { name: /Porto/ }).click();
  const inPorto = shell().getByRole('list', { name: 'Photos in Porto' });
  await inPorto.getByRole('button', { name: 'shore.png' }).focus();
  await shell().keyboard.press('Delete');
  await expect.poll(() => fs.existsSync(path.join(porto, 'shore.png'))).toBe(false);

  await shell().getByRole('button', { name: /Recently Deleted/ }).click();
  const bin = shell().getByRole('list', { name: 'Photos in Recently Deleted' });
  await bin.getByRole('button', { name: 'shore.png from Porto' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Recover' }).click();
  await expect.poll(() => fs.existsSync(path.join(porto, 'shore.png.edits.json'))).toBe(true);
  expect(fs.readFileSync(path.join(porto, 'shore.png'))).toEqual(PNG);
});

test('a filter and a turn are kept with the edits, and undo takes them back one at a time', async () => {
  await start();
  const read = () => (fs.existsSync(editsFile()) ? JSON.parse(fs.readFileSync(editsFile(), 'utf8')) : null);
  await shell().getByRole('tab', { name: 'Filters' }).click();
  await shell().getByRole('radiogroup', { name: 'Filters' }).getByRole('radio', { name: 'Mono' }).click();
  await expect.poll(() => read()?.adjustments[0]).toMatchObject({ id: 'filter', name: 'Mono', saturation: -100 });
  await shell().getByRole('tab', { name: 'Crop' }).click();
  const crop = shell().getByRole('tabpanel', { name: 'Crop' });
  await crop.getByRole('button', { name: 'Rotate left' }).click();
  await expect.poll(() => read()?.geometry?.turns).toBe(1);
  await crop.getByRole('button', { name: 'Done' }).click();
  // In a narrow window the inspector floats over the right of the page, so the photo is clicked at its corner.
  await shell().getByRole('img', { name: 'The photo with edits' }).click({ position: { x: 4, y: 4 } });
  await shell().keyboard.press('Control+z');
  await expect.poll(() => read()?.geometry).toBeUndefined();
  await shell().keyboard.press('Control+z');
  await expect.poll(() => read()?.adjustments).toEqual([]);
  await shell().keyboard.press('Control+Shift+z');
  await expect.poll(() => read()?.adjustments[0]?.name).toBe('Mono');
  // The photo itself never changes.
  expect(fs.readFileSync(path.join(album(), 'coastline.png'))).toEqual(PNG);
});

test('Mobius adds an adjustment to the edits, shown dashed, and it is kept or discarded', async () => {
  await start([
    callsTool('files-write', { path: 'photos/Lisbon/coastline.png.edits.json', content: JSON.stringify(WARM) }),
    says(['Added Warm the hills, below the middle; the sky is untouched.']),
  ]);
  // Photo's Adjust is in the inspector; Mobius's suggestions are in the Mobius panel beside it.
  await shell().getByRole('button', { name: 'Warm it up' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('sky is untouched');
  // The picture itself goes too, for models that read pictures.
  const sent = (model!.requests[0]!.messages as Array<{ role: string; content: unknown }>).filter((m) => m.role === 'user').pop()!.content as Array<{ type: string }>;
  expect(sent.map((p) => p.type)).toEqual(['text', 'image_url']);
  // The change is waiting, dashed, at the top of Adjust in the inspector.
  await shell().getByRole('tab', { name: 'Adjust', exact: true }).first().click();
  const change = shell().getByRole('group', { name: "Mobius's change" });
  await expect(change).toContainText('Mobius changed Warm the hills');
  await expect(panel().getByRole('option', { name: /Warm the hills/ })).toHaveAttribute('data-proposed', 'true');
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => fs.existsSync(editsFile())).toBe(false);
  await expect(panel().getByRole('option', { name: /Warm the hills/ })).toHaveCount(0);
});
