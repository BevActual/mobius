import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

// Five seconds of colour bars, 160 × 90, VP8.
const BARS = Buffer.from('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', 'base64');
const ROUGH = { version: 1, shots: [{ id: 's1', clip: 'sunset.webm', in: 1, out: 3, title: 'Lisbon' }, { id: 's2', clip: 'terrace.webm', in: 0, out: 2 }] };

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-video-'));
  fs.mkdirSync(project(), { recursive: true });
  fs.writeFileSync(path.join(project(), 'terrace.webm'), BARS);
  fs.writeFileSync(path.join(project(), 'sunset.webm'), BARS);
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
function project() { return path.join(userData, 'workspace', 'video', 'Offsite recap'); }
const cutFile = () => path.join(project(), 'cut.json');
const saved = () => JSON.parse(fs.readFileSync(cutFile(), 'utf8')) as typeof ROUGH;
const footage = (): Locator => shell().getByRole('region', { name: 'Footage' });
const timeline = (): Locator => shell().getByRole('listbox', { name: 'Timeline' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Video');
  await shell().keyboard.press('Enter');
  await expect(footage()).toBeVisible();
}

test('clips are played through the media address, added to the cut as shots, trimmed and titled', async () => {
  await start();
  // The player reads each clip's length from the file.
  await expect(footage().getByRole('listitem').filter({ hasText: 'terrace.webm' })).toContainText('0:05.0');
  await footage().getByRole('button', { name: 'Add terrace.webm to the cut' }).click();
  await footage().getByRole('button', { name: 'Add sunset.webm to the cut' }).click();
  await expect.poll(() => fs.existsSync(cutFile()) && saved().shots.map((s) => [s.clip, s.in, s.out])).toEqual([['terrace.webm', 0, 5], ['sunset.webm', 0, 5]]);

  await timeline().getByRole('option', { name: /^Shot 2: sunset\.webm/ }).click();
  const shot = shell().getByRole('region', { name: 'Shot' });
  // In and Out read as timecode, and take it or plain seconds.
  await expect(shot.getByRole('textbox', { name: 'Out' })).toHaveValue('0:05.0');
  await shot.getByRole('textbox', { name: 'Out' }).fill('2.5');
  await shot.getByRole('textbox', { name: 'Out' }).press('Enter');
  await expect(shot.getByRole('textbox', { name: 'Out' })).toHaveValue('0:02.5');
  await shot.getByRole('textbox', { name: 'Title' }).fill('Sunset');
  await shot.getByRole('button', { name: 'Earlier' }).click();
  await expect.poll(() => saved().shots.map((s) => [s.clip, s.out, (s as { title?: string }).title ?? ''])).toEqual([['sunset.webm', 2.5, 'Sunset'], ['terrace.webm', 5, '']]);
  await expect(shell().getByLabel('Length', { exact: true })).toHaveText('0:07.5');

  const before = await shell().getByLabel('Time', { exact: true }).textContent();
  await shell().getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play' }).click();
  await expect(shell().getByLabel('Time', { exact: true })).not.toHaveText(before ?? '', { timeout: 5000 });
  await expect(shell().getByRole('status').filter({ hasText: 'cannot be played' })).toHaveCount(0);

  // A shot's right-click menu duplicates it, the copy right after it.
  await timeline().getByRole('option', { name: /^Shot 1: sunset\.webm/ }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Shot 1' }).getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect.poll(() => saved().shots.map((s) => [s.clip, s.out, (s as { title?: string }).title ?? ''])).toEqual([['sunset.webm', 2.5, 'Sunset'], ['sunset.webm', 2.5, 'Sunset'], ['terrace.webm', 5, '']]);
});

test('a rough cut from Mobius is shown dashed, and kept', async () => {
  await start([
    callsTool('files-write', { path: 'video/Offsite recap/cut.json', content: JSON.stringify(ROUGH) }),
    says(['A 4-second rough cut: the sunset with a title, then the terrace.']),
  ]);
  // Video's Shot tab comes first in the right panel; Mobius is the last tab.
  await shell().getByRole('tablist', { name: 'Panel' }).getByRole('tab', { name: 'Mobius' }).click();
  await shell().getByRole('button', { name: 'Make a rough cut' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('rough cut');
  const change = shell().getByRole('group', { name: "Mobius's change" });
  await expect(change).toContainText('Mobius made the cut');
  await expect(timeline().getByRole('option')).toHaveCount(2);
  await expect(timeline().getByRole('option', { name: /^Shot 1: sunset\.webm, 0:02\.0, titled Lisbon/ })).toHaveAttribute('data-proposed', 'true');
  await change.getByRole('button', { name: 'Keep' }).click();
  await expect(change).toBeHidden();
  expect(saved().shots).toHaveLength(2);
});

test('the cut is exported as a film in the project’s Exports folder, never listed as footage', async () => {
  fs.writeFileSync(cutFile(), JSON.stringify({ version: 1, shots: [{ id: 's1', clip: 'sunset.webm', in: 0, out: 1, title: 'Lisbon' }, { id: 's2', clip: 'terrace.webm', in: 1, out: 2 }] }));
  await start();
  await expect(timeline().getByRole('option')).toHaveCount(2);
  await shell().getByRole('group', { name: 'Edit' }).getByRole('button', { name: /^Export/ }).click();
  // It plays through once (two seconds) while it is made.
  const done = shell().getByRole('status').filter({ hasText: 'Saved the film as Exports/Offsite recap.' });
  await expect(done).toBeVisible({ timeout: 30_000 });
  const exports = path.join(project(), 'Exports');
  const films = fs.readdirSync(exports);
  expect(films).toHaveLength(1);
  expect(films[0]).toMatch(/^Offsite recap\.(mp4|webm)$/);
  expect(fs.statSync(path.join(exports, films[0]!)).size).toBeGreaterThan(1000);
  await expect(footage().getByRole('listitem')).toHaveCount(2);
});
