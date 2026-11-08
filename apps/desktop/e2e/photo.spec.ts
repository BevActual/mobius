import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
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
const panel = (): Locator => shell().getByRole('complementary', { name: 'Adjustments' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Photo');
  await shell().keyboard.press('Enter');
  await expect(shell().getByRole('img', { name: 'The photo with edits' })).toBeVisible();
}

test('adjustments are kept beside the photo, which never changes, and Export saves a new picture', async () => {
  await start();
  await panel().getByRole('button', { name: 'Add adjustment' }).click();
  await panel().getByRole('slider', { name: 'Warmth' }).fill('30');
  await panel().getByRole('combobox', { name: 'Applies to' }).selectOption('below');
  await expect.poll(() => fs.existsSync(editsFile()) && JSON.parse(fs.readFileSync(editsFile(), 'utf8')).adjustments[0]).toMatchObject({ warmth: 30, area: { kind: 'below' } });
  expect(fs.readFileSync(path.join(album(), 'coastline.png'))).toEqual(PNG);
  await panel().getByRole('button', { name: 'Hide Adjustment 1' }).click();
  await expect.poll(() => JSON.parse(fs.readFileSync(editsFile(), 'utf8')).adjustments[0].hidden).toBe(true);

  await shell().getByRole('button', { name: 'Export' }).click();
  await expect(shell().getByRole('status').filter({ hasText: 'Saved as coastline edited.jpg' })).toBeVisible();
  expect(fs.readFileSync(path.join(album(), 'coastline edited.jpg')).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  await expect(shell().getByRole('navigation', { name: 'Albums' }).getByRole('button', { name: /coastline edited\.jpg/ })).toBeVisible();
});

test('Mobius adds an adjustment to the edits, shown dashed, and it is kept or discarded', async () => {
  await start([
    callsTool('files-write', { path: 'photos/Lisbon/coastline.png.edits.json', content: JSON.stringify(WARM) }),
    says(['Added Warm the hills, below the middle; the sky is untouched.']),
  ]);
  await shell().getByRole('button', { name: 'Warm it up' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('sky is untouched');
  // The picture itself goes too, for models that read pictures.
  const sent = (model!.requests[0]!.messages as Array<{ role: string; content: unknown }>).filter((m) => m.role === 'user').pop()!.content as Array<{ type: string }>;
  expect(sent.map((p) => p.type)).toEqual(['text', 'image_url']);
  const change = shell().getByRole('group', { name: "Mobius's change" });
  await expect(change).toContainText('Mobius changed Warm the hills');
  await expect(panel().getByRole('option', { name: /Warm the hills/ })).toHaveAttribute('data-proposed', 'true');
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => fs.existsSync(editsFile())).toBe(false);
  await expect(panel().getByRole('option', { name: /Warm the hills/ })).toHaveCount(0);
});
