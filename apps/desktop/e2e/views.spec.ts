import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

type Tile = { id: string; kind: string; size: string; show?: string };
const TODAY: { version: 1; tiles: Tile[] } = {
  version: 1,
  tiles: [
    { id: 't1', kind: 'tasks', size: 'small', show: 'all' },
    { id: 't2', kind: 'notes', size: 'small' },
  ],
};

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-views-'));
  const write = (rel: string, content: string) => { const f = path.join(userData, 'workspace', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  write('views/Views/Today.json', JSON.stringify(TODAY));
  write('tasks/Inbox.md', '# Inbox\n\n- [ ] Buy tulip bulbs\n- [ ] Call the bank\n');
  write('notes/Home/Garden.md', '# Garden\n\nPlant the tulips before the frost.\n');
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
const file = () => path.join(userData, 'workspace', 'views', 'Views', 'Today.json');
const saved = () => JSON.parse(fs.readFileSync(file(), 'utf8')) as { tiles: Tile[] };
const page = (): Locator => shell().getByRole('region', { name: 'Today' });
/** A tile, by what it reads out: its name, then what it holds ("Tasks · All: 2 to do"). */
const tile = (name: RegExp): Locator => page().getByRole('listitem', { name });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' }).first()).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Views');
  await shell().keyboard.press('Enter');
  await shell().getByRole('button', { name: 'Today', exact: true }).click();
  await expect(tile(/^Tasks · All: 2 to do$/)).toBeVisible();
}

test('a view shows live tiles from the apps, and tiles are added, resized, moved and removed, kept as JSON', async () => {
  await start();
  // Live: the tasks and the note are there, and a row opens its app.
  await expect(tile(/^Tasks · All/)).toContainText('Buy tulip bulbs');
  await expect(tile(/^Notes/)).toContainText('Garden');
  await tile(/^Notes/).getByRole('button', { name: /Garden/ }).click();
  await expect(shell().locator('.ProseMirror').first()).toContainText('Plant the tulips', { timeout: 10_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Views');
  await shell().keyboard.press('Enter');

  // Add tile adds one at the end.
  await page().getByRole('button', { name: 'Add tile' }).click();
  await shell().getByRole('menuitem', { name: 'Mail' }).click();
  await expect.poll(() => saved().tiles.map((t) => t.kind)).toEqual(['tasks', 'notes', 'mail']);
  await expect(tile(/^Mail/)).toContainText('Add a mail account in Mail.');

  // The tile's menu makes it wide, changes what it shows and moves it.
  await tile(/^Tasks · All/).hover();
  await tile(/^Tasks · All/).getByRole('button', { name: 'More for Tasks · All' }).click();
  await shell().getByRole('menuitem', { name: 'Make wide' }).click();
  await expect.poll(() => saved().tiles[0]).toEqual({ id: 't1', kind: 'tasks', size: 'wide', show: 'all' });
  await tile(/^Tasks · All/).hover();
  await tile(/^Tasks · All/).getByRole('button', { name: 'More for Tasks · All' }).click();
  await shell().getByRole('menuitem', { name: 'Move later' }).click();
  await expect.poll(() => saved().tiles.map((t) => t.id)).toEqual(['t2', 't1', 't3']);

  // Edit shows a remove button on each tile; Undo puts a removed tile back where it was.
  await page().getByRole('button', { name: 'Edit' }).click();
  await page().getByRole('button', { name: 'Remove Notes' }).click();
  await expect.poll(() => saved().tiles.map((t) => t.id)).toEqual(['t1', 't3']);
  await page().getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => saved().tiles.map((t) => t.id)).toEqual(['t2', 't1', 't3']);
  await page().getByRole('button', { name: 'Done' }).click();
  await expect(page().getByRole('button', { name: 'Remove Notes' })).toBeHidden();
});

test('a new view starts with the usual tiles, and an emptied one offers them again', async () => {
  await start();
  await shell().getByRole('button', { name: 'New view' }).first().click();
  await expect(shell().getByRole('region', { name: 'Untitled' }).getByLabel(/^Mobius:/)).toBeVisible();
  const made = path.join(userData, 'workspace', 'views', 'Views', 'Untitled.json');
  await expect.poll(() => (JSON.parse(fs.readFileSync(made, 'utf8')) as { tiles: Tile[] }).tiles.map((t) => t.kind)).toEqual(['mobius', 'tasks', 'calendar', 'mail', 'notes']);
  fs.writeFileSync(made, '{"version":1,"tiles":[]}');
  await shell().getByRole('button', { name: 'Today', exact: true }).click();
  await shell().getByRole('button', { name: 'Untitled', exact: true }).click();
  await shell().getByRole('button', { name: 'Add the usual tiles' }).click();
  await expect.poll(() => (JSON.parse(fs.readFileSync(made, 'utf8')) as { tiles: Tile[] }).tiles).toHaveLength(5);
});

test('Mobius adding tiles shows them dashed, to keep or discard', async () => {
  const more = { version: 1, tiles: [...TODAY.tiles, { id: 't3', kind: 'calendar', size: 'small', show: 'week' }] };
  await start([
    callsTool('files-write', { path: 'views/Views/Today.json', content: JSON.stringify(more) }),
    says(['Added the week ahead.']),
  ]);
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' }).first();
  await composer.fill('Add my week to this view');
  await composer.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('week ahead');
  await expect(tile(/^Calendar · Next 7 days/)).toHaveAttribute('data-proposed', 'true');
  await expect(tile(/^Tasks · All/)).not.toHaveAttribute('data-proposed', 'true');
  const change = page().getByRole('group', { name: "Mobius's change" });
  await expect(change).toContainText('Mobius changed one tile here');
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => saved().tiles.map((t) => t.id)).toEqual(['t1', 't2']);
  await expect(tile(/^Calendar/)).toBeHidden();
});
