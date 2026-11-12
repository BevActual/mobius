import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

const SONG = { version: 1, tempo: 112, key: 'A minor', bars: 4, tracks: [{ id: 't1', name: 'Keys', instrument: 'piano', volume: 0.8, notes: [{ pitch: 57, start: 0, length: 4, velocity: 0.7 }, { pitch: 60, start: 0, length: 4, velocity: 0.7 }] }] };
const BASS = { id: 't2', name: 'Bass', instrument: 'bass', volume: 0.8, notes: [0, 4, 8, 12].map((start) => ({ pitch: 45, start, length: 1.5, velocity: 0.9 })) };

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-studio-'));
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(SONG));
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
function file() { return path.join(userData, 'workspace', 'studio', 'Songs', 'Night Drive.json'); }
const saved = () => JSON.parse(fs.readFileSync(file(), 'utf8')) as typeof SONG;
const tracks = (): Locator => shell().getByRole('list', { name: 'Tracks' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Music');
  await shell().keyboard.press('Enter');
  await shell().getByRole('button', { name: 'Night Drive', exact: true }).click();
  await expect(tracks().getByRole('listitem', { name: 'Keys' })).toBeVisible();
}

test('a song is tracks of notes: added by clicking, with tracks to add, mute and play', async () => {
  await start();
  const roll = shell().getByRole('grid', { name: 'Notes of Keys' });
  await roll.getByRole('gridcell', { name: 'E4 row' }).click({ position: { x: 4 * 40 + 5, y: 6 } });
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.pitch === 64)).toEqual({ pitch: 64, start: 4, length: 1, velocity: 0.8 });
  // A click picks a note; a double-click takes it out.
  await roll.getByLabel('E4 at beat 5, 1 beats').dblclick();
  await expect.poll(() => saved().tracks[0]!.notes.some((n) => n.pitch === 64)).toBe(false);

  await shell().getByRole('combobox', { name: 'Add a track' }).selectOption('drums');
  await expect.poll(() => saved().tracks.map((t) => t.instrument)).toEqual(['piano', 'drums']);
  await expect(shell().getByRole('grid', { name: 'Notes of Drums' }).getByRole('rowheader')).toHaveText(['Open hat', 'Closed hat', 'Tom', 'Clap', 'Snare', 'Kick']);
  await tracks().getByRole('button', { name: 'Mute Keys' }).click();
  await expect.poll(() => (saved().tracks[0] as { muted?: boolean }).muted).toBe(true);
  await shell().getByRole('spinbutton', { name: 'Tempo' }).fill('96');
  await expect.poll(() => saved().tempo).toBe(96);

  await shell().getByRole('button', { name: 'Play' }).click();
  await expect(shell().getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(shell().getByLabel('Position')).not.toHaveText('1.1BAR', { timeout: 5000 });
  await shell().getByRole('button', { name: 'Stop' }).click();
});

test('notes are moved, stretched, picked with a box and deleted, and Undo takes each step back', async () => {
  await start();
  // Raw drags press where things are drawn, so the window is big enough for the roll, and each target is scrolled in.
  await resizeWindow(mobius!.app, 1440, 900);
  const roll = shell().getByRole('grid', { name: 'Notes of Keys' });
  await roll.getByRole('gridcell', { name: 'E4 row' }).click({ position: { x: 4 * 40 + 5, y: 6 } });
  await expect.poll(() => saved().tracks[0]!.notes.length).toBe(3);
  // Dragged one beat later and two semitones up.
  const note = roll.getByLabel('E4 at beat 5, 1 beats');
  await note.scrollIntoViewIfNeeded();
  let box = (await note.boundingBox())!;
  await shell().mouse.move(box.x + 10, box.y + 5);
  await shell().mouse.down();
  await shell().mouse.move(box.x + 30, box.y - 10, { steps: 4 });
  await shell().mouse.move(box.x + 50, box.y - 23, { steps: 4 });
  await shell().mouse.up();
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.start === 5)).toEqual({ pitch: 66, start: 5, length: 1, velocity: 0.8 });
  // Stretched by a beat from its end: the chord's top note, near the left, so the drag stays inside a narrow window.
  const end = roll.getByLabel('C4 at beat 1, 4 beats').locator('.studio-note-end');
  await end.scrollIntoViewIfNeeded();
  box = (await end.boundingBox())!;
  await shell().mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await shell().mouse.up();
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.pitch === 60)?.length).toBe(5);
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.pitch === 60)?.length).toBe(4);
  // A box drawn from the empty space after the opening chord back across it picks both notes; Delete takes them out.
  await roll.getByLabel('C4 at beat 1, 4 beats').scrollIntoViewIfNeeded();
  const top = (await roll.getByRole('gridcell', { name: 'C4 row' }).boundingBox())!;
  const bottom = (await roll.getByRole('gridcell', { name: 'A3 row' }).boundingBox())!;
  await shell().mouse.move(top.x + 4.5 * 40, top.y + 3);
  await shell().mouse.down();
  await shell().mouse.move(top.x + 20, bottom.y + 8, { steps: 6 });
  await shell().mouse.up();
  await expect(shell().getByRole('toolbar', { name: 'Notes' })).toContainText('2 notes');
  await roll.press('Delete');
  await expect.poll(() => saved().tracks[0]!.notes.map((n) => n.pitch)).toEqual([66]);
  // A track duplicated, then taken back.
  await tracks().getByRole('button', { name: 'Duplicate Keys' }).click();
  await expect.poll(() => saved().tracks.map((t) => t.name)).toEqual(['Keys', 'Keys copy']);
  await shell().getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => saved().tracks.map((t) => t.name)).toEqual(['Keys']);
});

test('a part from Mobius is a new track of notes, dashed until kept or discarded', async () => {
  await start([
    callsTool('files-write', { path: 'studio/Songs/Night Drive.json', content: JSON.stringify({ ...SONG, tracks: [...SONG.tracks, BASS] }) }),
    says(['Added a bass line on the roots, on 1 and the and of 3.']),
  ]);
  await shell().getByRole('button', { name: 'Add a bass line' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('bass line');
  const change = shell().getByRole('group', { name: "Mobius's change" });
  await expect(change).toContainText('Mobius changed Bass');
  await expect(tracks().getByRole('listitem', { name: 'Bass' }).locator('.studio-lane')).toHaveAttribute('data-proposed', 'true');
  await expect(tracks().getByRole('listitem', { name: 'Keys' }).locator('.studio-lane')).not.toHaveAttribute('data-proposed', 'true');
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => saved().tracks.map((t) => t.id)).toEqual(['t1']);
  await expect(tracks().getByRole('listitem', { name: 'Bass' })).toHaveCount(0);
});

test('velocity is drawn under the roll and dragged per note; the track list fits its tracks and resizes', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, BASS] }));
  await start();
  await resizeWindow(mobius!.app, 1440, 900);
  await expect(tracks().getByRole('listitem', { name: 'Bass' })).toBeInViewport();
  // Each note has a bar in the velocity lane; dragging one up makes that note louder and leaves the others alone. The
  // chord's notes share a beat, so A3 is picked first: a picked note's bar is drawn on top.
  await shell().getByRole('grid', { name: 'Notes of Keys' }).getByLabel('A3 at beat 1, 4 beats').click({ position: { x: 20, y: 4 } });
  const lane = shell().getByRole('group', { name: 'Velocity of Keys' });
  const bar = lane.getByRole('slider', { name: 'Velocity of A3 at beat 1', exact: true });
  await expect(bar).toHaveAttribute('aria-valuenow', String(Math.round(0.7 * 127)));
  const box = (await bar.boundingBox())!;
  await shell().mouse.move(box.x + box.width / 2, box.y + 4);
  await shell().mouse.down();
  await shell().mouse.move(box.x + box.width / 2, box.y - 8, { steps: 4 });
  await shell().mouse.up();
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.pitch === 57)!.velocity).toBeGreaterThan(0.7);
  expect(saved().tracks[0]!.notes.find((n) => n.pitch === 60)!.velocity).toBe(0.7);
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.pitch === 57)!.velocity).toBe(0.7);
  // The divider gives the notes more room from the keyboard, and Home fits the list to its tracks again.
  const divider = shell().getByRole('separator', { name: 'Resize tracks and notes' });
  const fit = Number(await divider.getAttribute('aria-valuenow'));
  await divider.focus();
  await shell().keyboard.press('ArrowUp');
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.max(96, fit - 24)));
  await shell().keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', String(fit));
  // Drums get rows tall enough to name each drum in full.
  await tracks().getByRole('listitem', { name: 'Bass' }).click();
  await shell().getByRole('combobox', { name: 'Add a track' }).selectOption('drums');
  const head = shell().getByRole('grid', { name: 'Notes of Drums' }).getByRole('rowheader', { name: 'Closed hat' });
  expect((await head.boundingBox())!.height).toBeGreaterThanOrEqual(26);
});
