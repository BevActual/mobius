import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

const HOME = {
  version: 1,
  styles: [{ name: 'Ink', color: '#1d1d1f' }],
  frames: [{ id: 'f1', name: 'Home', x: 0, y: 0, w: 393, h: 852, fill: '#ffffff', radius: 30, children: [
    { id: 'n1', type: 'text', name: 'Title', x: 24, y: 96, w: 345, h: 40, text: 'Lisbon offsite', size: 32, weight: 700, color: 'style:Ink' },
    { id: 'n2', type: 'rect', name: 'Card', x: 24, y: 160, w: 345, h: 180, fill: '#f2f2f7', radius: 20 },
  ] }],
};
const DARK = { ...HOME, styles: [...HOME.styles, { name: 'Night', color: '#000000' }], frames: [...HOME.frames, { ...HOME.frames[0]!, id: 'f2', name: 'Home — Dark', x: 473, fill: 'style:Night', children: [{ ...HOME.frames[0]!.children[0]!, id: 'n3', color: '#ffffff' }] }] };

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  lastSaved = undefined;
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-design-'));
  fs.mkdirSync(path.join(userData, 'workspace', 'designs', 'Trip app'), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(HOME));
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
function file() { return path.join(userData, 'workspace', 'designs', 'Trip app', 'Home.json'); }
// The app may be part-way through writing the file: then the last whole read stands, and a poll asks again.
let lastSaved: typeof HOME | undefined;
const saved = (): typeof HOME => {
  try { lastSaved = JSON.parse(fs.readFileSync(file(), 'utf8')) as typeof HOME; } catch (e) { if (!lastSaved) throw e; }
  return lastSaved;
};
const canvas = (): Locator => shell().getByRole('application', { name: 'Canvas' });
const inspector = (): Locator => shell().getByRole('complementary', { name: 'Inspector' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Design');
  await shell().keyboard.press('Enter');
  await shell().getByRole('button', { name: 'Home', exact: true }).click();
  await expect(canvas().getByLabel('Frame Home')).toBeVisible();
}

test('a design is frames of layers: selected, changed in the inspector, added and deleted, and kept as JSON', async () => {
  await start();
  await shell().getByRole('tree', { name: 'Frames and layers' }).getByRole('button', { name: 'Title' }).click();
  await expect(inspector()).toContainText('passes AA');
  await inspector().getByRole('textbox', { name: 'Text', exact: true }).fill('Porto offsite');
  await inspector().getByRole('textbox', { name: 'Y', exact: true }).fill('120');
  await inspector().getByRole('textbox', { name: 'Y', exact: true }).press('Enter');
  await expect.poll(() => saved().frames[0]!.children[0]).toMatchObject({ text: 'Porto offsite', y: 120 });
  await expect(canvas().getByLabel('Text Title')).toHaveText('Porto offsite');

  await shell().getByRole('toolbar', { name: 'Design tools' }).getByRole('button', { name: 'Ellipse' }).click();
  await expect.poll(() => saved().frames[0]!.children.map((c) => c.type)).toEqual(['text', 'rect', 'ellipse']);
  await inspector().getByRole('button', { name: 'Delete layer' }).click();
  await expect.poll(() => saved().frames[0]!.children).toHaveLength(2);
  await shell().getByRole('toolbar', { name: 'Design tools' }).getByRole('button', { name: 'Frame' }).click();
  await expect.poll(() => saved().frames.map((f) => [f.name, f.x])).toEqual([['Home', 0], ['Frame 2', 473]]);
});

test('a dark version from Mobius shows dashed, and is kept or discarded', async () => {
  await start([
    callsTool('files-write', { path: 'designs/Trip app/Home.json', content: JSON.stringify(DARK) }),
    says(['Added Home — Dark, using a new Night style. Text contrast passes AA.']),
    callsTool('files-write', { path: 'designs/Trip app/Home.json', content: JSON.stringify({ ...DARK, frames: [DARK.frames[0], { ...DARK.frames[1], name: 'Home — Dim' }] }) }),
    says(['Renamed it.']),
  ]);
  // With Mobius open beside the page the canvas is narrow; a bigger window keeps the change bar clear of the inspector.
  await resizeWindow(mobius!.app, 1440, 900);
  await shell().getByRole('button', { name: 'Make a dark version' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('Night style');
  await expect(canvas().getByLabel('Frame Home — Dark')).toHaveAttribute('data-proposed', 'true');
  await expect(canvas().getByLabel('Frame Home', { exact: true })).not.toHaveAttribute('data-proposed', 'true');
  const change = canvas().getByRole('group', { name: "Mobius's change" });
  await expect(change).toContainText('Mobius changed 2 layers here');
  await change.getByRole('button', { name: 'Keep' }).click();
  await expect(change).toBeHidden();
  expect(saved().frames).toHaveLength(2);

  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Call it Dim');
  await composer.press('Enter');
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(canvas().getByLabel('Frame Home — Dim')).toHaveAttribute('data-proposed', 'true');
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => saved().frames[1]!.name).toBe('Home — Dark');
  await expect(canvas().getByLabel('Frame Home — Dark')).toBeVisible();
});

test('layers are drawn with a tool, picked together, lined up, duplicated and typed on the canvas', async () => {
  await start();
  // A raw drag presses where things are drawn, so the window is big enough and the drag stays in the part of the
  // frame the canvas shows.
  await resizeWindow(mobius!.app, 1440, 900);
  const tree = shell().getByRole('tree', { name: 'Frames and layers' });
  // R, then a drag on the frame, draws a rectangle there.
  await canvas().focus();
  await shell().keyboard.press('r');
  const whole = (await canvas().getByLabel('Frame Home').boundingBox())!;
  const view = (await canvas().boundingBox())!;
  const left = Math.max(whole.x, view.x), top = Math.max(whole.y, view.y);
  const frame = { x: left, y: top, width: Math.min(whole.x + whole.width, view.x + view.width) - left, height: Math.min(whole.y + whole.height, view.y + view.height) - top };
  await shell().mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.6);
  await shell().mouse.down();
  await shell().mouse.move(frame.x + frame.width * 0.5, frame.y + frame.height * 0.7, { steps: 5 });
  await shell().mouse.up();
  await expect.poll(() => saved().frames[0]!.children.map((c) => c.type)).toEqual(['text', 'rect', 'rect']);
  // Shift-click two layers in the list, then line their left edges up.
  await tree.getByRole('button', { name: 'Card' }).click();
  await tree.getByRole('button', { name: 'Rectangle' }).click({ modifiers: ['Shift'] });
  await expect(inspector()).toContainText('2 layers');
  await inspector().getByRole('button', { name: 'Align left' }).click();
  await expect.poll(() => saved().frames[0]!.children.slice(1).map((c) => c.x)).toEqual([24, 24]);
  // Ctrl+D copies them a little down and right.
  await canvas().focus();
  await shell().keyboard.press('Control+d');
  await expect.poll(() => saved().frames[0]!.children).toHaveLength(5);
  // Double-click a text layer to type on the canvas; Escape keeps it.
  await canvas().getByLabel('Text Title').dblclick();
  await shell().getByRole('textbox', { name: 'Text of Title' }).fill('Porto offsite');
  await shell().keyboard.press('Escape');
  await expect.poll(() => saved().frames[0]!.children[0]!.text).toBe('Porto offsite');
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().frames[0]!.children[0]!.text).toBe('Lisbon offsite');
});
