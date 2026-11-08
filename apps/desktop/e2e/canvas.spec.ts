import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

type Item = { id: string; type: string; x?: number; y?: number; text?: string; color?: string; from?: string; to?: string };
const IDEAS: { version: 1; items: Item[] } = {
  version: 1,
  items: [
    { id: 's1', type: 'sticky', x: 0, y: 0, w: 180, h: 180, color: 'yellow', text: 'Walkable' } as Item,
    { id: 's2', type: 'sticky', x: 220, y: 0, w: 180, h: 180, color: 'pink', text: 'Under $6k' } as Item,
    { id: 'b1', type: 'shape', shape: 'rect', x: 110, y: 260, w: 200, h: 100, color: 'white', text: 'Book by Friday' } as Item,
  ],
};
const THEMED = {
  version: 1,
  items: [
    { id: 't1', type: 'text', x: 0, y: -80, w: 300, h: 40, text: 'Must haves' },
    { ...IDEAS.items[0]!, color: 'green' },
    IDEAS.items[1],
    IDEAS.items[2],
    { id: 'a1', type: 'arrow', from: 's1', to: 'b1' },
  ],
};

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-canvas-'));
  fs.mkdirSync(path.join(userData, 'workspace', 'boards', 'Offsite'), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(IDEAS));
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
function file() { return path.join(userData, 'workspace', 'boards', 'Offsite', 'Ideas.json'); }
const saved = () => JSON.parse(fs.readFileSync(file(), 'utf8')) as { items: Item[] };
const board = (): Locator => shell().getByRole('application', { name: 'Board' });
const tools = (): Locator => shell().getByRole('toolbar', { name: 'Canvas tools' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Canvas');
  await shell().keyboard.press('Enter');
  await shell().getByRole('button', { name: 'Ideas', exact: true }).click();
  await expect(board().getByLabel('Sticky: Walkable')).toBeVisible();
}

/** Drags with the mouse from the middle of one element to the middle of another (or by an offset). */
async function drag(from: Locator, to: Locator | { dx: number; dy: number }): Promise<void> {
  const a = (await from.boundingBox())!;
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  let end: { x: number; y: number };
  if ('dx' in to) end = { x: start.x + to.dx, y: start.y + to.dy };
  else { const b = (await to.boundingBox())!; end = { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
  await shell().mouse.move(start.x, start.y);
  await shell().mouse.down();
  await shell().mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
  await shell().mouse.move(end.x, end.y, { steps: 4 });
  await shell().mouse.up();
}

test('a board is stickies, shapes and arrows: added, written on, moved, joined, recoloured and deleted, and kept as JSON', async () => {
  await start();
  // A new sticky where you double-click, written on at once.
  const box = (await board().boundingBox())!;
  await shell().mouse.dblclick(box.x + box.width - 120, box.y + box.height - 120);
  await shell().keyboard.type('Vegetarian lunch');
  await shell().keyboard.press('Escape');
  await expect.poll(() => saved().items.find((x) => x.id === 's3')).toMatchObject({ type: 'sticky', text: 'Vegetarian lunch', color: 'yellow' });

  // Moved by dragging; the arrow tool joins two items.
  const before = saved().items.find((x) => x.id === 's1')!;
  await drag(board().getByLabel('Sticky: Walkable'), { dx: 40, dy: 20 });
  await expect.poll(() => saved().items.find((x) => x.id === 's1')!.x).toBeGreaterThan(before.x! + 20);
  await tools().getByRole('radio', { name: 'Arrow' }).click();
  await drag(board().getByLabel('Sticky: Under $6k'), board().getByLabel('Shape: Book by Friday'));
  await expect.poll(() => saved().items.filter((x) => x.type === 'arrow')).toEqual([{ id: 'a1', type: 'arrow', from: 's2', to: 'b1' }]);
  await tools().getByRole('textbox', { name: 'Arrow label' }).fill('if yes');
  await expect.poll(() => saved().items.find((x) => x.id === 'a1')?.text).toBe('if yes');
  await expect(board().getByRole('button', { name: 'Arrow: if yes' })).toBeVisible();

  // A colour changes what is selected; Delete takes it away with its arrows.
  await board().getByLabel('Sticky: Under $6k').click();
  await tools().getByRole('radio', { name: 'blue' }).click();
  await expect.poll(() => saved().items.find((x) => x.id === 's2')?.color).toBe('blue');
  await shell().keyboard.press('Delete');
  await expect.poll(() => saved().items.map((x) => x.id)).toEqual(['s1', 'b1', 's3']);
  // Undo puts it back with its arrow; redo takes it away again.
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().items.map((x) => x.id)).toEqual(['s1', 's2', 'b1', 's3', 'a1']);
  await shell().keyboard.press('Control+Shift+z');
  await expect.poll(() => saved().items.map((x) => x.id)).toEqual(['s1', 'b1', 's3']);

  // Written on again with a double-click.
  await board().getByLabel('Shape: Book by Friday').dblclick();
  await shell().getByRole('textbox', { name: 'Shape text' }).fill('Book by Thursday');
  await shell().keyboard.press('Escape');
  await expect.poll(() => saved().items.find((x) => x.id === 'b1')?.text).toBe('Book by Thursday');
});

test('Mobius sorting the board shows dashed, and is kept or discarded', async () => {
  await start([
    callsTool('files-write', { path: 'boards/Offsite/Ideas.json', content: JSON.stringify(THEMED) }),
    says(['Sorted into one theme, Must haves, and joined Walkable to the booking.']),
    callsTool('files-write', { path: 'boards/Offsite/Ideas.json', content: JSON.stringify({ ...THEMED, items: THEMED.items.slice(1) }) }),
    says(['Took the heading away.']),
  ]);
  await shell().getByRole('button', { name: 'Sort into themes' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('Must haves');
  await expect(board().getByLabel('Text: Must haves')).toHaveAttribute('data-proposed', 'true');
  await expect(board().getByLabel('Sticky: Walkable')).toHaveAttribute('data-proposed', 'true');
  await expect(board().getByLabel('Sticky: Under $6k')).not.toHaveAttribute('data-proposed', 'true');
  const change = board().getByRole('group', { name: "Mobius's change" });
  await expect(change).toContainText('Mobius changed 3 items here');
  await change.getByRole('button', { name: 'Keep' }).click();
  await expect(change).toBeHidden();
  expect(saved().items).toHaveLength(5);

  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('Take the heading away');
  await composer.press('Enter');
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(change).toContainText('Mobius took away one item');
  await expect(board().getByLabel('Text: Must haves')).toBeHidden();
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => saved().items.map((x) => x.id)).toEqual(['t1', 's1', 's2', 'b1', 'a1']);
  await expect(board().getByLabel('Text: Must haves')).toBeVisible();
});
