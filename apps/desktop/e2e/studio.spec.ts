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
type Note = { pitch: number; start: number; length: number; velocity: number };
type SavedClip = { id: string; start: number; length: number; name?: string; muted?: boolean; notes: Note[] };
/** The saved song, with each track's notes also read out of its clips into song time, as the notes editor shows them. */
const saved = () => {
  const song = JSON.parse(fs.readFileSync(file(), 'utf8')) as { version: number; tracks: { clips?: SavedClip[]; notes: Note[] }[] };
  // A file the app has not saved since it was written (by a test or by Mobius) may still be version 1, notes and all.
  for (const t of song.tracks) if (t.clips) t.notes = t.clips.flatMap((c) => c.notes.map((n) => ({ ...n, start: c.start + n.start }))).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return song as unknown as typeof SONG & { version: number; tracks: (typeof SONG.tracks[number] & { clips: SavedClip[]; auto?: Record<string, { beat: number; value: number }[]> })[] };
};
const tracks = (): Locator => shell().getByRole('list', { name: 'Tracks' });

/**
 * Brings the songs list to the front: with a song open it is the Browser's Songs place; with none open it is the only
 * panel on the left.
 */
async function showSongs(): Promise<void> {
  const place = shell().getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Songs', exact: true });
  await expect(place.or(shell().getByRole('complementary', { name: 'Songs' })).first()).toBeVisible();
  if ((await place.count()) > 0 && (await place.getAttribute('aria-current')) !== 'true') await place.click();
}
/**
 * Opens a song from the songs list. Music reopens the last song a moment after it starts, which turns the songs list
 * into a tab behind the Library: a click aimed while that happens waits on a hidden row, so the list is brought to the
 * front again and the click tried again until it lands.
 */
async function openSong(name: string): Promise<void> {
  await expect(async () => {
    await showSongs();
    await shell().getByRole('button', { name, exact: true }).click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
/** Adds a track from Sounds in the songs list. */
async function addTrack(name: string): Promise<void> {
  await showSongs();
  await shell().getByRole('complementary', { name: 'Songs' }).getByRole('region', { name: 'Sounds' }).getByRole('button', { name, exact: true }).click();
}
/** Opens the notes editor on a track, with a double-click on its first clip. */
async function openNotes(name: string): Promise<void> {
  await tracks().getByRole('listitem', { name }).getByRole('button', { name: new RegExp(`^${name}, bars? 1`) }).dblclick();
  await expect(shell().getByRole('grid', { name: `Notes of ${name}` })).toBeVisible();
}

/** Opens a track's devices in the bottom area, with a double-click on its header. */
async function openDevice(name: string): Promise<Locator> {
  await tracks().getByRole('listitem', { name }).locator('.studio-track-no').dblclick();
  const device = shell().getByRole('region', { name: 'Devices' });
  await expect(device).toBeVisible();
  return device;
}

/** Starts Mobius on Music's Night Drive, with the notes of `track` open. */
async function start(replies: ModelReply[] = [], track = 'Keys'): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Music');
  await shell().keyboard.press('Enter');
  await openSong('Night Drive');
  await expect(tracks().getByRole('listitem', { name: track })).toBeVisible();
  await openNotes(track);
}

test('a song is tracks of notes: added by clicking, with tracks to add, mute and play', async () => {
  await start();
  const roll = shell().getByRole('grid', { name: 'Notes of Keys' });
  await roll.getByRole('gridcell', { name: 'E4 row' }).click({ position: { x: 4 * 40 + 5, y: 6 } });
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.pitch === 64)).toEqual({ pitch: 64, start: 4, length: 1, velocity: 0.8 });
  // Saved as version 2: Arrange's notes are kept in clips, each note timed from its clip's start.
  expect(saved().version).toBe(2);
  expect(saved().tracks[0]!.clips.find((c) => c.start === 4)?.notes).toEqual([{ pitch: 64, start: 0, length: 1, velocity: 0.8 }]);
  // A click picks a note; a double-click takes it out.
  await roll.getByLabel('E4 at beat 5, 1 beats').dblclick();
  await expect.poll(() => saved().tracks[0]!.notes.some((n) => n.pitch === 64)).toBe(false);

  await addTrack('Drums');
  await expect.poll(() => saved().tracks.map((t) => t.instrument)).toEqual(['piano', 'drums']);
  await expect(shell().getByRole('grid', { name: 'Notes of Drums' }).getByRole('rowheader')).toHaveText(['Open hat', 'Closed hat', 'Tom', 'Clap', 'Snare', 'Kick']);
  await tracks().getByRole('button', { name: 'Mute Keys' }).click();
  await expect.poll(() => (saved().tracks[0] as { muted?: boolean }).muted).toBe(true);
  await shell().getByRole('spinbutton', { name: 'Tempo' }).fill('96');
  await expect.poll(() => saved().tempo).toBe(96);

  // The chosen track's devices set how it sounds, kept in the song. Shift+Tab switches the bottom area to them.
  await tracks().getByRole('listitem', { name: 'Keys' }).click({ position: { x: 6, y: 6 } });
  await shell().keyboard.press('Shift+Tab');
  const cutoff = shell().getByRole('region', { name: 'Devices' }).getByRole('slider', { name: 'Cutoff and resonance' });
  await cutoff.focus();
  await shell().keyboard.press('ArrowLeft');
  await expect.poll(() => (saved().tracks[0] as { sound?: { cutoff: number } }).sound?.cutoff).toBeLessThan(5000);

  await shell().getByRole('button', { name: 'Play' }).click();
  await expect(shell().getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(shell().getByLabel('Position')).not.toHaveText('1 . 1 . 1', { timeout: 5000 });
  await shell().getByRole('button', { name: 'Stop' }).click();
  await expect(shell().getByRole('button', { name: 'Play' })).toBeVisible();
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
  // A track duplicated from its menu, then taken back.
  await tracks().getByRole('listitem', { name: 'Keys' }).getByRole('textbox', { name: 'Track name' }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Keys' }).getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect.poll(() => saved().tracks.map((t) => t.name)).toEqual(['Keys', 'Keys copy']);
  await roll.press('Control+z');
  await expect.poll(() => saved().tracks.map((t) => t.name)).toEqual(['Keys']);
});

test('a part from Mobius is a new track of notes, dashed until kept or discarded', async () => {
  await start([
    callsTool('files-write', { path: 'studio/Songs/Night Drive.json', content: JSON.stringify({ ...SONG, tracks: [...SONG.tracks, BASS] }) }),
    says(['Added a bass line on the roots, on 1 and the and of 3.']),
  ]);
  // The right panel is Mobius alone (devices are in the bottom area), made wide enough to sit beside the page rather than over it.
  await resizeWindow(mobius!.app, 1440, 900);
  await shell().getByRole('button', { name: 'Add a bass line' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log.locator('.msg.assistant')).toContainText('bass line');
  // What Mobius proposes is kept or discarded in the bar above the tracks.
  const change = shell().getByRole('group', { name: 'A change Mobius made' });
  await expect(change).toContainText('Mobius changed Bass');
  // The new part's clip is dashed; the Keys clip is not.
  await expect(tracks().getByRole('listitem', { name: 'Bass' }).getByRole('button', { name: 'Bass, bars 1 to 4, proposed by Mobius' })).toHaveAttribute('data-proposed', 'true');
  await expect(tracks().getByRole('listitem', { name: 'Keys' }).getByRole('button', { name: 'Keys, bar 1' })).not.toHaveAttribute('data-proposed', 'true');
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => saved().tracks.map((t) => t.id)).toEqual(['t1']);
  await expect(tracks().getByRole('listitem', { name: 'Bass' })).toHaveCount(0);
});

test('a sound from Mobius opens the track’s devices and says what moved, kept or put back', async () => {
  const warmer = { ...SONG.tracks[0], sound: { shape: 0.2, detune: 0, sub: 0, drive: 0.15, cutoff: 1200, resonance: 0, envAmount: 0, attack: 0.005, decay: 0.8, sustain: 0.3, release: 0.3, vibrato: 0, rate: 5 } };
  await start([
    callsTool('files-write', { path: 'studio/Songs/Night Drive.json', content: JSON.stringify({ ...SONG, tracks: [warmer] }) }),
    says(['Made the keys warmer: the filter is down to 1.2 kHz with a little drive.']),
  ]);
  await resizeWindow(mobius!.app, 1440, 900);
  await shell().getByRole('textbox', { name: 'Message Mobius' }).fill('make the keys warmer');
  await shell().keyboard.press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await log.getByRole('group', { name: 'Approval needed: files.write' }).getByRole('button', { name: 'Allow once' }).click();
  const change = shell().getByRole('group', { name: 'A change Mobius made' });
  await expect(change).toContainText('Mobius changed Keys: drive 0% → 15%, cutoff 5.0 kHz → 1.2 kHz');
  // The track's devices open, so the knobs Mobius moved are in view; its notes are not marked as changed.
  await expect(shell().getByRole('region', { name: 'Devices' })).toBeVisible();
  await expect(shell().getByRole('slider', { name: 'Cutoff and resonance' })).toHaveAttribute('aria-valuetext', /Cutoff 1\.2 kHz/);
  // The moved knob is marked as Mobius's until it is kept or put back; one Mobius didn't touch is not.
  const devices = shell().getByRole('region', { name: 'Devices' });
  await expect(devices.locator('.ui-knob[data-proposed]').filter({ has: shell().getByRole('slider', { name: 'Drive' }) })).toHaveCount(1);
  await expect(devices.locator('.ui-knob[data-proposed]').filter({ has: shell().getByRole('slider', { name: 'Shape' }) })).toHaveCount(0);
  await change.getByRole('button', { name: 'Discard' }).click();
  await expect(devices.locator('[data-proposed]')).toHaveCount(0);
  await expect.poll(() => (saved().tracks[0] as { sound?: unknown }).sound).toBeUndefined();
});

test('the demo ask: a bass line and a warmer pad come in while the song plays, as two edits, and Try another keeps it playing', async () => {
  // The demo song in small: keys and a bright pad, and no bass, written out as the seed is (a track to a line).
  const PAD_SOUND = '{"shape":1,"detune":14,"sub":0,"drive":0,"cutoff":4200,"resonance":0.2,"envAmount":0,"attack":0.25,"decay":0.3,"sustain":1,"release":0.5,"vibrato":0,"rate":5}';
  const WARM = PAD_SOUND.replace('"shape":1', '"shape":0.6').replace('"drive":0', '"drive":0.1').replace('"cutoff":4200', '"cutoff":1900').replace('"resonance":0.2', '"resonance":0.12');
  const last = '{"pitch":69,"start":0,"length":16,"velocity":0.6}\n    ]}\n  ]\n}\n';
  fs.writeFileSync(file(), `{\n  "version": 1, "tempo": 112, "key": "A minor", "bars": 4,\n  "tracks": [\n    {"id":"t1","name":"Keys","instrument":"piano","volume":0.8,"notes":[{"pitch":57,"start":0,"length":4,"velocity":0.7}]},\n    {"id":"t2","name":"Pad","instrument":"pad","volume":0.55,"sound":${PAD_SOUND},"notes":[\n      ${last}`);
  const bass = (pitch: number) => `,\n    ${JSON.stringify({ ...BASS, id: 't3', notes: BASS.notes.map((n) => ({ ...n, pitch })) })}`;
  // One answer: a line first, then both edits, so the turn ends as soon as they are made (the chip finishes on changes).
  const edits = (pitch: number, line: string): ModelReply => ({
    chunks: [
      { data: { choices: [{ index: 0, delta: { content: line } }] }, pauseMs: 0 },
      { data: { choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'files-edit', arguments: JSON.stringify({ path: 'studio/Songs/Night Drive.json', old: `"sound":${PAD_SOUND}`, new: `"sound":${WARM}` }) } },
        { index: 1, id: 'call_2', function: { name: 'files-edit', arguments: JSON.stringify({ path: 'studio/Songs/Night Drive.json', old: last, new: last.replace(/\]\}\n {2}\]/, `]}${bass(pitch)}\n  ]`) }) } },
      ] } }] }, pauseMs: 0 },
      { data: { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }, pauseMs: 0 },
    ],
  });
  // Try another is a plain message, not the chip, so its turn asks once more after the edits: that answer ends it.
  await start([edits(45, 'Adding a bass on the roots and warming the pad.'), edits(33, 'Another bass, an octave down.'), says(['An octave lower, on the roots.'])]);
  await resizeWindow(mobius!.app, 1600, 900);
  // The ask fits a song with a pad and no bass, so it leads Music's suggestions, and it is made while the song plays.
  // The four bars go round, as in the demo (without the loop they end after 8.6 s, mid-test). Space plays them even with
  // a clip focused, as anywhere else in Music.
  await shell().getByRole('button', { name: 'Loop', exact: true }).click();
  await expect(shell().getByRole('button', { name: 'Loop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tracks().getByRole('listitem', { name: 'Keys' }).getByRole('button', { name: 'Keys, bar 1' }).focus();
  await shell().keyboard.press('Space');
  await expect(shell().getByRole('button', { name: 'Pause' })).toBeVisible();
  await shell().getByRole('button', { name: 'Bass and a warmer pad' }).click();
  const log = shell().getByRole('log', { name: 'Conversation' });
  const allow = log.getByRole('group', { name: 'Approval needed: files.edit' }).getByRole('button', { name: 'Allow once' });
  const change = shell().getByRole('group', { name: 'A change Mobius made' });
  // Both edits are allowed (one at a time, as they come), then the bar says what each did.
  const allowBoth = (bass: RegExp) => expect(async () => {
    if (await allow.count()) await allow.first().click();
    await expect(change).toContainText(bass, { timeout: 500 });
    await expect(change).toContainText('Pad: shape 100% → 60%, drive 0% → 10%, cutoff 4.2 kHz → 1.9 kHz', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await allowBoth(/Bass, bars 1 to 4/);
  await expect(tracks().getByRole('listitem', { name: 'Bass' }).getByRole('button', { name: 'Bass, bars 1 to 4, proposed by Mobius' })).toHaveAttribute('data-proposed', 'true');
  // Only the pad's sound changed, so its clip is not dashed.
  await expect(tracks().getByRole('listitem', { name: 'Pad' }).getByRole('button', { name: 'Pad, bars 1 to 4' })).not.toHaveAttribute('data-proposed', 'true');
  // The pad's devices open with the moved knobs marked, and the song never stopped.
  const devices = shell().getByRole('region', { name: 'Devices' });
  await expect(devices.getByRole('slider', { name: 'Cutoff and resonance' })).toHaveAttribute('aria-valuetext', /Cutoff 1\.9 kHz/);
  await expect(devices.locator('.ui-knob[data-proposed]').filter({ has: shell().getByRole('slider', { name: 'Drive' }) })).toHaveCount(1);
  await expect(shell().getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(saved().tracks.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  // Try another puts it back and asks again; the new line comes in, still playing.
  await change.getByRole('button', { name: 'Try another' }).click();
  await expect(log.locator('.msg.assistant').last()).toContainText('Another bass');
  await allowBoth(/Bass, bars 1 to 4/);
  await expect.poll(() => saved().tracks[2]?.notes[0]?.pitch).toBe(33);
  await expect(shell().getByRole('button', { name: 'Pause' })).toBeVisible();
  await change.getByRole('button', { name: 'Keep' }).click();
  await expect(tracks().getByRole('listitem', { name: 'Bass' }).getByRole('button', { name: 'Bass, bars 1 to 4' })).not.toHaveAttribute('data-proposed', 'true');
});

test('a track is panned and a drum kit is tuned in its devices, kept in the song', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, { id: 't3', name: 'Drums', instrument: 'drums', volume: 0.8, notes: [] }] }));
  await start();
  const device = await openDevice('Keys');
  const pan = device.getByRole('slider', { name: 'Pan' });
  await pan.focus();
  await shell().keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => (saved().tracks[0] as { pan?: number }).pan).toBeLessThan(0);
  await expect(pan).toHaveAttribute('aria-valuetext', /^L \d+$/);
  // A drums track has a kit instead of an oscillator: tuning it moves every drum together.
  await tracks().getByRole('listitem', { name: 'Drums' }).click();
  await expect(device.getByRole('slider', { name: 'Cutoff and resonance' })).toHaveCount(0);
  const tune = device.getByRole('region', { name: 'Kit' }).getByRole('slider', { name: 'Tune' });
  await tune.focus();
  await shell().keyboard.press('ArrowRight');
  await expect.poll(() => (saved().tracks[1] as { kit?: { tune: number } }).kit?.tune).toBe(1);
  await expect(tune).toHaveAttribute('aria-valuetext', '+1 st');
});

test('effects are added to a track, switched off and moved, kept in the song', async () => {
  fs.writeFileSync(file(), JSON.stringify(SONG));
  await start();
  const device = await openDevice('Keys');
  for (const name of ['Delay', 'EQ']) {
    await device.getByRole('button', { name: 'Add effect' }).click();
    await shell().getByRole('menuitem', { name, exact: true }).click();
  }
  await expect.poll(() => (saved().tracks[0] as { fx?: { kind: string }[] }).fx?.map((e) => e.kind)).toEqual(['delay', 'eq']);
  // Each effect is a device in the chain: its grip moves it with the arrow keys (or a drag).
  await device.getByRole('button', { name: 'Move EQ', exact: true }).focus();
  await shell().keyboard.press('ArrowUp');
  await device.getByRole('switch', { name: 'Delay on' }).click();
  await expect.poll(() => (saved().tracks[0] as { fx?: { kind: string; on: boolean }[] }).fx?.map((e) => `${e.kind} ${e.on}`)).toEqual(['eq true', 'delay false']);
  await device.getByRole('button', { name: 'Remove Delay' }).click();
  await expect.poll(() => (saved().tracks[0] as { fx?: { kind: string }[] }).fx?.map((e) => e.kind)).toEqual(['eq']);
  // The instrument has its own switch too: it bypasses the instrument alone, and leaves the track unmuted.
  await device.getByRole('switch', { name: 'Instrument on' }).click();
  await expect.poll(() => (saved().tracks[0] as { instrumentOn?: boolean }).instrumentOn).toBe(false);
  expect((saved().tracks[0] as { muted?: boolean }).muted).toBeUndefined();
  // A device folds to its head, and opens again.
  await device.getByRole('button', { name: 'Fold Instrument' }).click();
  await expect(device.getByRole('region', { name: 'Oscillator' })).toHaveCount(0);
  await device.getByRole('button', { name: 'Show Instrument' }).click();
  await expect(device.getByRole('region', { name: 'Oscillator' })).toBeVisible();
});

test('an LFO and an envelope follower move a track setting, by a share of its range, kept in the song', async () => {
  fs.writeFileSync(file(), JSON.stringify(SONG));
  await start();
  const device = await openDevice('Keys');
  const mods = device.getByRole('region', { name: 'Modulators' });
  await mods.getByRole('button', { name: 'Add modulator' }).click();
  await shell().getByRole('menuitem', { name: /^LFO/ }).click();
  const saved0 = () => (saved().tracks[0] as { mods?: { kind: string; target: string; amount: number; sync?: number }[] }).mods;
  await expect.poll(() => saved0()?.[0]).toMatchObject({ kind: 'lfo', target: 'volume', amount: 0.25, sync: 4 });
  // Pan runs -1 to 1, so the same share of its range is twice the amount in its own units.
  await mods.getByRole('combobox', { name: 'Moves' }).click();
  await shell().getByRole('option', { name: 'Pan', exact: true }).click();
  await expect.poll(() => saved0()?.[0]).toMatchObject({ target: 'pan', amount: 0.5 });
  await mods.getByRole('button', { name: 'Add modulator' }).click();
  await shell().getByRole('menuitem', { name: /^Envelope Follower/ }).click();
  await expect.poll(() => saved0()?.map((m) => m.kind)).toEqual(['lfo', 'follow']);
  await mods.getByRole('button', { name: 'Remove LFO' }).click();
  await expect.poll(() => saved0()?.map((m) => m.kind)).toEqual(['follow']);
});

test('a Shaper draws its own line, and a Gate\'s sidechain EQ is kept in the song', async () => {
  await start();
  const device = await openDevice('Keys');
  const mods = device.getByRole('region', { name: 'Modulators' });
  await mods.getByRole('button', { name: 'Add modulator' }).click();
  await shell().getByRole('menuitem', { name: /^Shaper/ }).click();
  const shaper = () => (saved().tracks[0] as { mods?: { kind: string; points?: { beat: number; value: number }[] }[] }).mods?.[0];
  await expect.poll(shaper).toMatchObject({ kind: 'shaper', points: [{ beat: 0, value: 1 }, { beat: 0.5, value: -1 }] });
  const plot = mods.getByRole('group', { name: 'Shaper line automation' }).locator('.ui-lane-plot');
  const box = (await plot.boundingBox())!;
  await plot.click({ position: { x: box.width * 0.75, y: box.height * 0.5 } });
  await expect.poll(() => shaper()?.points?.length).toBe(3);
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: 'Gate', exact: true }).click();
  const side = device.getByRole('region', { name: 'Gate sidechain' });
  await side.getByRole('switch', { name: 'Sidechain EQ' }).click();
  const gate = () => ((saved().tracks[0] as { fx?: { sidechain?: unknown }[] }).fx ?? [])[0]?.sidechain;
  await expect.poll(gate).toEqual({ eq: { type: 'highpass', freq: 100 } });
  await side.getByRole('switch', { name: 'Sidechain EQ' }).click();
  await expect.poll(gate).toEqual({ eq: { type: 'highpass', freq: 100, on: false } });
});

test('the newer effects: a Saturator\'s Drive and an Auto Filter\'s type, kept in the song', async () => {
  await start();
  const device = await openDevice('Keys');
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: 'Saturator', exact: true }).click();
  const fx = () => (saved().tracks[0] as { fx?: Record<string, unknown>[] }).fx ?? [];
  await expect.poll(() => fx()[0]).toMatchObject({ kind: 'saturator', drive: 6, mix: 1 });
  await device.getByRole('group', { name: 'Saturator settings' }).getByRole('slider', { name: 'Drive' }).focus();
  await shell().keyboard.press('ArrowUp');
  await expect.poll(() => fx()[0]?.drive as number).toBeGreaterThan(6);
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: 'Auto Filter', exact: true }).click();
  await device.getByRole('combobox', { name: 'Filter' }).click();
  await shell().getByRole('option', { name: 'High-pass', exact: true }).click();
  await expect.poll(() => fx()[1]).toMatchObject({ kind: 'autofilter', filter: 'highpass', shape: 'sine' });
});

test('Beat Repeat: its Interval and Grid as note values, its mix mode and Chance, kept in the song', async () => {
  await start();
  const device = await openDevice('Keys');
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: 'Beat Repeat', exact: true }).click();
  const fx = () => ((saved().tracks[0] as { fx?: Record<string, unknown>[] }).fx ?? [])[0];
  await expect.poll(fx).toMatchObject({ kind: 'beatrepeat', interval: 16, grid: 2, gate: 8, chance: 1, mix: 'mix' });
  await device.getByRole('combobox', { name: 'Interval' }).click();
  await shell().getByRole('option', { name: '1/4', exact: true }).click();
  await device.getByRole('combobox', { name: 'Grid' }).click();
  await shell().getByRole('option', { name: '1/16', exact: true }).click();
  await device.getByRole('radiogroup', { name: 'Mix mode' }).getByRole('radio', { name: 'Insert' }).click();
  await device.getByRole('group', { name: 'Beat Repeat settings' }).getByRole('slider', { name: 'Chance' }).focus();
  await shell().keyboard.press('ArrowDown');
  await expect.poll(() => fx()?.chance as number).toBeLessThan(1);
  expect(fx()).toMatchObject({ interval: 4, grid: 1, mix: 'insert' });
});

test('Chorus-Ensemble: Vibrato mode, the high-pass and inverted feedback, kept in the song', async () => {
  await start();
  const device = await openDevice('Keys');
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: 'Chorus-Ensemble', exact: true }).click();
  const fx = () => ((saved().tracks[0] as { fx?: Record<string, unknown>[] }).fx ?? [])[0];
  await expect.poll(fx).toMatchObject({ kind: 'chorus', mode: 'chorus', feedback: 0, invert: false, highpass: 0 });
  const knobs = device.getByRole('group', { name: 'Chorus-Ensemble settings' });
  await knobs.getByRole('slider', { name: 'Feedback' }).focus();
  await shell().keyboard.press('ArrowUp');
  await device.getByRole('switch', { name: 'Invert feedback' }).click();
  await device.getByRole('switch', { name: 'High-pass filter' }).click();
  await expect.poll(fx).toMatchObject({ invert: true, highpass: 200 });
  expect(fx()?.feedback as number).toBeGreaterThan(0);
  // A fresh Chorus switched to Vibrato takes Vibrato's quicker wobble, and its Feedback and Dry/Wet rest.
  await device.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Vibrato' }).click();
  await expect.poll(fx).toMatchObject({ mode: 'vibrato', delay: 0.005, rate: 5, depth: 0.002 });
  await expect(knobs.getByRole('slider', { name: 'Dry/Wet' })).toBeDisabled();
});

test('an instrument stack: chains with their own instruments and key zones, kept in the song', async () => {
  await start();
  const device = await openDevice('Keys');
  await device.getByRole('button', { name: 'Stack instruments' }).click();
  const stack = () => (saved().tracks[0] as { stack?: { chains: Record<string, unknown>[] } }).stack;
  await expect.poll(() => stack()?.chains).toEqual([{ instrument: 'piano' }]);
  const rack = device.getByRole('list', { name: 'Instrument chains' });
  await rack.getByRole('button', { name: 'Add chain' }).click();
  await rack.getByRole('combobox', { name: 'Chain 2 instrument' }).click();
  await shell().getByRole('option', { name: 'Bass', exact: true }).click();
  await rack.getByRole('listitem', { name: 'Chain 1' }).getByRole('slider', { name: 'Key high' }).focus();
  await shell().keyboard.press('ArrowDown');
  await expect.poll(() => stack()?.chains).toEqual([{ instrument: 'piano', keys: { low: 0, high: 126 } }, { instrument: 'bass' }]);
  await device.getByRole('button', { name: 'Remove Instrument Stack' }).click();
  await expect.poll(() => stack()).toBeUndefined();
});

test('a compressor keyed by another track: Audio From, Gain and Dry/Wet, kept in the song', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, BASS] }));
  await start();
  const device = await openDevice('Keys');
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: 'Compressor', exact: true }).click();
  const side = device.getByRole('region', { name: 'Compressor sidechain' });
  await side.getByRole('combobox', { name: 'Audio From' }).click();
  await shell().getByRole('option', { name: 'Bass', exact: true }).click();
  const keyed = () => (saved().tracks[0] as { fx?: { sidechain?: { track: string; gain?: number; mix?: number } }[] }).fx?.[0]?.sidechain;
  await expect.poll(keyed).toEqual({ track: 't2' });
  await side.getByRole('slider', { name: 'Gain' }).focus();
  await shell().keyboard.press('ArrowUp');
  await side.getByRole('slider', { name: 'Dry/Wet' }).focus();
  await shell().keyboard.press('ArrowLeft');
  await expect.poll(() => keyed()?.gain).toBeGreaterThan(0);
  await expect.poll(() => keyed()?.mix).toBeLessThan(1);
  // None takes the sidechain off.
  await side.getByRole('combobox', { name: 'Audio From' }).click();
  await shell().getByRole('option', { name: 'None', exact: true }).click();
  await expect.poll(keyed).toBeUndefined();
});

test('a stack runs chains of effects side by side, with a macro mapped to a setting in one, kept in the song', async () => {
  fs.writeFileSync(file(), JSON.stringify(SONG));
  await start();
  const device = await openDevice('Keys');
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: /^Stack/ }).click();
  const fx = () => (saved().tracks[0] as { fx?: { kind: string; chains: { fx: { id: string; kind: string }[] }[]; macros: { value: number; maps: { target: string }[] }[] }[] }).fx?.[0];
  await expect.poll(() => fx()?.kind).toBe('stack');
  const chain = device.getByRole('listitem', { name: 'Chain 1' });
  await chain.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: /^Reverb/ }).click();
  await expect.poll(() => fx()?.chains[0]?.fx.map((e) => e.kind)).toEqual(['reverb']);
  const reverb = fx()!.chains[0]!.fx[0]!.id;
  // Macro 1 maps to the reverb's Mix, and turning it is kept.
  await device.getByRole('button', { name: 'Map' }).first().click();
  await shell().getByRole('menuitemcheckbox', { name: /Reverb Mix/ }).click();
  await expect.poll(() => fx()?.macros[0]?.maps.map((m) => m.target)).toEqual([`fx:${reverb}:mix`]);
  await device.getByRole('slider', { name: 'Macro 1' }).focus();
  await shell().keyboard.press('ArrowUp');
  await expect.poll(() => fx()?.macros[0]?.value ?? 0).toBeGreaterThan(0);
  await device.getByRole('button', { name: 'Add chain' }).click();
  await expect.poll(() => fx()?.chains.length).toBe(2);
});

test('a song’s own device plays on the track with the knobs its file names, kept in the song', async () => {
  const TONE = { name: 'Dark Echo', about: 'Echoes that get darker each time round', parts: [
    { id: 'in', kind: 'input' }, { id: 'echo', kind: 'delay', time: 0.75 }, { id: 'tone', kind: 'filter', type: 'lowpass', cutoff: 3000 },
    { id: 'back', kind: 'gain', gain: 0.45 }, { id: 'mix', kind: 'mix', amount: 0.35 }, { id: 'out', kind: 'output' },
  ], cables: [['in', 'mix.dry'], ['in', 'echo'], ['echo', 'tone'], ['tone', 'back'], ['back', 'echo'], ['tone', 'mix.wet'], ['mix', 'out']],
  controls: [{ label: 'Tone', part: 'tone', param: 'cutoff' }, { label: 'Repeats', part: 'back', param: 'gain', max: 0.9 }] };
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [{ ...SONG.tracks[0], fx: [{ id: 'fx1', kind: 'device', on: true, device: TONE }] }] }));
  await start();
  const device = await openDevice('Keys');
  // It sits in the chain like the built-in effects, with its own name, what it is for, and its controls as knobs.
  await expect(device.getByText('Echoes that get darker each time round')).toBeVisible();
  const tone = device.getByRole('slider', { name: 'Tone' });
  await expect(tone).toHaveAttribute('aria-valuetext', '3.0 kHz');
  await tone.focus();
  await shell().keyboard.press('ArrowLeft');
  const cutoff = () => (saved().tracks[0] as { fx?: { device: { parts: { id: string; cutoff?: number }[] } }[] }).fx?.[0]?.device.parts.find((p) => p.id === 'tone')?.cutoff ?? 3000;
  await expect.poll(cutoff).toBeLessThan(3000);
  // It plays: the song starts and stops with the device on the track.
  await shell().getByRole('button', { name: 'Play' }).click();
  await expect(shell().getByRole('button', { name: 'Pause' })).toBeVisible();
  await shell().getByRole('button', { name: 'Stop' }).click();
  await device.getByRole('switch', { name: 'Dark Echo on' }).click();
  await expect.poll(() => (saved().tracks[0] as { fx?: { on: boolean }[] }).fx?.[0]?.on).toBe(false);
});

test('the Workbench opens an effect up as its parts and cables, with the level on each cable while the song plays', async () => {
  await start();
  const device = await openDevice('Keys');
  await device.getByRole('button', { name: 'Add effect' }).click();
  await shell().getByRole('menuitem', { name: 'Delay', exact: true }).click();
  await device.getByRole('button', { name: 'Open Delay in Workbench' }).click();
  // A built-in effect is shown as the device it is made of: its parts as boxes, the echo's repeats cabled back into it.
  const bench = shell().getByRole('region', { name: 'Workbench: Delay' });
  await expect(bench).toBeVisible();
  await expect(bench.getByText('Built in')).toBeVisible();
  const canvas = bench.getByRole('group', { name: 'Delay parts and cables' });
  for (const name of ['Input', 'echo', 'back', 'mix', 'Output']) await expect(bench.getByRole('group', { name, exact: true })).toBeVisible();
  await expect(bench.getByRole('group', { name: 'echo', exact: true }).getByText('0.75 beats')).toBeVisible();
  await expect(canvas.locator('path.ui-cable')).toHaveCount(6);
  // Playing, each cable carries its level; stopped, they go quiet.
  const levelled = bench.locator('path.ui-cable[style*="--level"]');
  await shell().getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => levelled.count()).toBeGreaterThan(0);
  await shell().getByRole('button', { name: 'Stop' }).click();
  await expect(levelled).toHaveCount(0);
  // Back (or Escape) returns to the track's devices, the song as it was.
  await bench.getByRole('button', { name: 'Back to devices' }).click();
  await expect(shell().getByRole('region', { name: 'Devices' })).toBeVisible();
  await expect.poll(() => (saved().tracks[0] as { fx?: { kind: string }[] }).fx?.map((e) => e.kind)).toEqual(['delay']);
});

test('a song with a device that breaks a rule says which, and is left as it is', async () => {
  const text = JSON.stringify({ ...SONG, tracks: [{ ...SONG.tracks[0], fx: [{ id: 'fx1', kind: 'device', device: { name: 'Loop', parts: [{ id: 'in', kind: 'input' }, { id: 'a', kind: 'gain' }, { id: 'b', kind: 'gain' }, { id: 'out', kind: 'output' }], cables: [['in', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'out']] } }] }] });
  fs.writeFileSync(file(), text);
  model = await startModel([]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Music');
  await shell().keyboard.press('Enter');
  await openSong('Night Drive');
  await expect(shell().getByText(/Track “Keys”, effect fx1: Loop has a loop with no delay in it \(a → b → a\)/)).toBeVisible();
  expect(fs.readFileSync(file(), 'utf8')).toBe(text);
});

test('a drum kit has a pad per drum with its own settings, and its notes can be written as steps', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [{ id: 't1', name: 'Drums', instrument: 'drums', volume: 0.8, notes: [{ pitch: 36, start: 0, length: 0.25, velocity: 0.8 }] }] }));
  await start([], 'Drums');
  const device = await openDevice('Drums');
  // Each drum is a pad; the chosen pad's knobs set that drum alone, kept in the song by its pitch.
  await device.getByRole('group', { name: 'Drum pads' }).getByRole('button', { name: 'Snare', exact: true }).click();
  const tune = device.getByRole('group', { name: 'Snare settings' }).getByRole('slider', { name: 'Tune' });
  await tune.focus();
  await shell().keyboard.press('ArrowRight');
  await expect.poll(() => (saved().tracks[0] as { pads?: Record<string, { tune: number }> }).pads?.['38']?.tune).toBe(1);
  // In the notes, Steps shows a bar of the drums as steps: a click switches one on, as a sixteenth note.
  await shell().getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Notes' }).click();
  await shell().getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Steps' }).click();
  await expect(shell().getByRole('group', { name: 'Kick' }).getByRole('button', { name: /^Kick, step 1, velocity/ })).toBeVisible();
  await shell().getByRole('group', { name: 'Snare' }).getByRole('button', { name: 'Snare, step 5', exact: true }).click();
  await expect.poll(() => saved().tracks[0]!.notes.find((n) => n.pitch === 38)).toMatchObject({ start: 1, length: 0.25 });
});

test('the Session view has clips to launch in scenes, each with its own notes, kept in the song', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, BASS] }));
  await start();
  await shell().getByRole('radio', { name: 'Session' }).click();
  const grid = shell().getByRole('grid', { name: 'Clips' });
  // A click on an empty slot makes a one-bar clip there and opens its notes in the bottom area.
  await grid.getByRole('button', { name: 'New clip on Keys, scene 1' }).click();
  await expect.poll(() => (saved().tracks[0] as { slots?: unknown[] }).slots).toEqual([{ name: 'Keys 1', bars: 1, notes: [] }]);
  await shell().getByRole('grid', { name: 'Notes of Keys' }).getByRole('gridcell', { name: 'E4 row' }).click({ position: { x: 5, y: 6 } });
  await expect.poll(() => (saved().tracks[0] as { slots?: { notes: unknown[] }[] }).slots?.[0]?.notes).toEqual([{ pitch: 64, start: 0, length: 1, velocity: 0.8 }]);
  // The arrangement's own notes are left as they were.
  expect(saved().tracks[0]!.notes).toHaveLength(2);
  await shell().getByRole('combobox', { name: 'Clip length' }).click();
  await shell().getByRole('option', { name: '2 bars' }).click();
  await expect.poll(() => (saved().tracks[0] as { slots?: { bars: number }[] }).slots?.[0]?.bars).toBe(2);
  // A scene is named, and launching it plays its row.
  await grid.getByRole('button', { name: 'New clip on Bass, scene 1' }).click();
  await grid.getByRole('textbox', { name: 'Scene 1 name' }).fill('Verse');
  await expect.poll(() => (saved() as { scenes?: string[] }).scenes).toEqual(['Verse']);
  await grid.getByRole('button', { name: 'Launch scene Verse' }).click();
  await expect(grid.getByRole('button', { name: 'Launch Keys 1, scene Verse' })).toHaveAttribute('aria-pressed', 'true');
  await grid.getByRole('button', { name: 'Stop all' }).click();
  await expect(grid.getByRole('button', { name: 'Launch Keys 1, scene Verse' })).toHaveAttribute('aria-pressed', 'false', { timeout: 6000 });
  await shell().getByRole('button', { name: 'Stop', exact: true }).click();
  // A clip's menu duplicates it into the slot below.
  await grid.getByRole('button', { name: 'Bass 1, 1 bar' }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Bass 1' }).getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect.poll(() => (saved().tracks[1] as { slots?: { name: string }[] }).slots?.map((c) => c.name)).toEqual(['Bass 1', 'Bass 1']);
  // Arrange is the song from start to end again.
  await shell().getByRole('radio', { name: 'Arrange' }).click();
  await expect(tracks()).toBeVisible();
});

test('clips go between Session and Arrange: dragged or copied either way, and looped bars become a new scene', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, BASS] }));
  await start();
  await resizeWindow(mobius!.app, 1440, 900);
  type Slot = { name: string; bars: number; notes: Note[] } | null;
  const slots = (i: number) => ((saved().tracks[i] as { slots?: Slot[] }).slots ?? []).map((c) => c?.name ?? null);
  // Looped bars 2 to 3 in Arrange become a new scene: a clip per track with what plays there (Live 12, 7.5).
  const ruler = shell().getByRole('slider', { name: 'Playhead' });
  const r = (await ruler.boundingBox())!;
  const bar = r.width / 4;
  await shell().mouse.move(r.x + bar * 1.5, r.y + 4);
  await shell().mouse.down();
  await shell().mouse.move(r.x + bar * 2.5, r.y + 4, { steps: 4 });
  await shell().mouse.up();
  await expect(ruler.getByRole('img', { name: 'Loop: bars 2 to 3' })).toBeVisible();
  await ruler.click({ button: 'right', position: { x: bar * 0.5, y: 16 } });
  await shell().getByRole('menu', { name: 'Loop' }).getByRole('menuitem', { name: 'Consolidate Loop to New Scene' }).click();
  await expect.poll(() => (saved().tracks[1] as { slots?: Slot[] }).slots?.[0]?.notes).toEqual([0, 4].map((start) => ({ pitch: 45, start, length: 1.5, velocity: 0.9 })));
  expect((saved().tracks[1] as { slots?: Slot[] }).slots?.[0]).toMatchObject({ name: 'Bass', bars: 2 });
  // Keys plays nothing there, so its slot in the scene stays empty.
  expect(slots(0)).toEqual([]);
  // An Arrange clip's menu copies it to Session, into the first empty slot of its track.
  await shell().getByRole('button', { name: 'Bass, bars 1 to 4' }).click({ button: 'right' });
  await shell().getByRole('menu').getByRole('menuitem', { name: 'Copy to Session' }).click();
  await expect.poll(() => slots(1)).toEqual(['Bass', 'Bass']);
  // In Session, a clip dragged onto another slot moves there.
  await shell().getByRole('radio', { name: 'Session' }).click();
  const grid = shell().getByRole('grid', { name: 'Clips' });
  await grid.getByRole('button', { name: 'Bass, 4 bars' }).dragTo(grid.getByRole('button', { name: 'New clip on Keys, scene 3' }));
  await expect.poll(() => slots(0)).toEqual([null, null, 'Bass']);
  expect(slots(1)).toEqual(['Bass']);
  // Its menu copies it to Arrange at the playhead's bar, as a looped clip that replaces what it covers.
  await grid.getByRole('button', { name: 'Bass, 2 bars' }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Bass' }).getByRole('menuitem', { name: 'Copy to Arrange at Bar 1' }).click();
  await expect.poll(() => saved().tracks[1]!.clips.map((c) => [c.start, c.length, c.name ?? ''])).toEqual([[0, 8, 'Bass'], [8, 8, '']]);
  // Dragged over Arrange's name, the view opens to drop it on a track there.
  const drag = await shell().evaluateHandle(() => new DataTransfer());
  await grid.getByRole('button', { name: 'Bass, 2 bars' }).dispatchEvent('dragstart', { dataTransfer: drag });
  await shell().getByRole('radio', { name: 'Arrange' }).dispatchEvent('dragover', { dataTransfer: drag });
  await expect(tracks()).toBeVisible();
  const lane = shell().locator('.studio-lane').nth(1);
  const box = (await lane.boundingBox())!;
  await lane.dispatchEvent('drop', { dataTransfer: drag, clientX: box.x + bar * 3 + 2, clientY: box.y + 4 });
  await expect.poll(() => saved().tracks[1]!.clips.map((c) => [c.start, c.length, c.name ?? ''])).toEqual([[0, 8, 'Bass'], [8, 4, ''], [12, 8, 'Bass']]);
  // Each move is one Undo.
  await ruler.press('Control+z');
  await expect.poll(() => saved().tracks[1]!.clips).toHaveLength(2);
});

test('Record in Session lays what is launched into Arrange, each clip going round for as long as it played', async () => {
  const riff = { name: 'Riff', bars: 1, notes: [{ pitch: 45, start: 0, length: 1, velocity: 0.9 }] };
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, { ...BASS, slots: [riff] }] }));
  await start();
  await shell().getByRole('radio', { name: 'Session' }).click();
  const grid = shell().getByRole('grid', { name: 'Clips' });
  // Record starts the Session's clock; a clip launched then is heard into Arrange (Live 12, 7.5).
  const rec = shell().getByRole('group', { name: 'Transport' }).getByRole('button', { name: 'Record' });
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');
  await grid.getByRole('button', { name: 'Launch Riff, scene 1' }).click();
  await expect(grid.getByRole('button', { name: 'Launch Riff, scene 1' })).toHaveAttribute('aria-pressed', 'true', { timeout: 6000 });
  await shell().waitForTimeout(1500);
  await shell().getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(rec).toHaveAttribute('aria-pressed', 'false');
  // On Bass in Arrange: a looped Riff from where it started, as long as it played; it replaced what was there.
  await expect.poll(() => saved().tracks[1]!.clips?.find((c) => c.name === 'Riff')).toMatchObject({ loop: { start: 0, end: 4 } });
  const laid = saved().tracks[1]!.clips.find((c) => c.name === 'Riff')!;
  expect(laid.start % 4).toBe(0);
  expect(laid.length).toBeGreaterThan(0.5);
  // One Undo takes it back out.
  await shell().getByRole('radio', { name: 'Arrange' }).click();
  await shell().getByRole('slider', { name: 'Playhead' }).press('Control+z');
  await expect.poll(() => (saved().tracks[1]!.clips ?? []).some((c) => c.name === 'Riff')).toBe(false);
});

test('a String track is a modelled string: plucked, struck or bowed, with its decay, damping, position and tone kept in the song', async () => {
  await start();
  await tracks().getByRole('button', { name: 'Add track' }).click();
  await shell().getByRole('menu', { name: 'Add track' }).getByRole('menuitem', { name: 'String' }).click();
  await expect.poll(() => saved().tracks.map((t) => [t.name, (t as { instrument?: string }).instrument])).toEqual([['Keys', 'piano'], ['String', 'string']]);
  const device = await openDevice('String');
  const string = device.getByRole('region', { name: 'String' });
  // No oscillators or filter: the string's own settings (Live 12's Tension).
  await expect(device.getByRole('slider', { name: 'Cutoff and resonance' })).toHaveCount(0);
  await expect(string.getByRole('slider', { name: 'Decay' })).toHaveAttribute('aria-valuetext', '3.0 s');
  await string.getByRole('combobox', { name: 'Exciter' }).click();
  await shell().getByRole('option', { name: 'Bow' }).click();
  await expect(string).toContainText('sounds for as long as the note is held');
  await string.getByRole('slider', { name: 'Damping' }).focus();
  await shell().keyboard.press('ArrowUp');
  await expect.poll(() => (saved().tracks[1] as { string?: unknown }).string).toEqual({ exciter: 'bow', decay: 3, damping: 0.41, position: 0.2, tone: 0.6 });
  // Another instrument chosen for the track leaves no string settings behind.
  await device.getByRole('combobox', { name: 'Instrument' }).click();
  await shell().getByRole('option', { name: 'Bass' }).click();
  await expect.poll(() => (saved().tracks[1] as { string?: unknown }).string).toBeUndefined();
});

test('a Mallet track is a struck resonator: what is struck, its decay, material, hardness and position kept in the song', async () => {
  await start();
  await tracks().getByRole('button', { name: 'Add track' }).click();
  await shell().getByRole('menu', { name: 'Add track' }).getByRole('menuitem', { name: 'Mallet' }).click();
  await expect.poll(() => saved().tracks.map((t) => [t.name, (t as { instrument?: string }).instrument])).toEqual([['Keys', 'piano'], ['Mallet', 'mallet']]);
  const device = await openDevice('Mallet');
  const mallet = device.getByRole('region', { name: 'Mallet' });
  // No oscillators or filter: the resonator's own settings (Live 12's Collision).
  await expect(device.getByRole('slider', { name: 'Cutoff and resonance' })).toHaveCount(0);
  await expect(mallet.getByRole('slider', { name: 'Decay' })).toHaveAttribute('aria-valuetext', '1.2 s');
  await mallet.getByRole('combobox', { name: 'Resonator' }).click();
  await shell().getByRole('option', { name: 'Bell' }).click();
  await expect(mallet).toContainText('a hum an octave below');
  await mallet.getByRole('slider', { name: 'Hardness' }).focus();
  await shell().keyboard.press('ArrowUp');
  await expect.poll(() => (saved().tracks[1] as { mallet?: unknown }).mallet).toEqual({ resonator: 'bell', decay: 1.2, material: 0.6, hardness: 0.51, position: 0.2 });
  // Another instrument chosen for the track leaves no mallet settings behind.
  await device.getByRole('combobox', { name: 'Instrument' }).click();
  await shell().getByRole('option', { name: 'Pad' }).click();
  await expect.poll(() => (saved().tracks[1] as { mallet?: unknown }).mallet).toBeUndefined();
});

test('locators mark places in the song: set at the playhead or in the ruler, named, stepped through, moved, looped to the next and deleted', async () => {
  await start();
  await resizeWindow(mobius!.app, 1440, 900);
  const locs = () => (saved() as { locators?: { beat: number; name: string }[] }).locators;
  const ruler = shell().getByRole('slider', { name: 'Playhead' });
  const r = (await ruler.boundingBox())!;
  const bar = r.width / 4;
  // Set Locator puts one at the playhead (the song's start); the ruler's menu puts one where it was right-clicked.
  await shell().getByRole('group', { name: 'Locators' }).getByRole('button', { name: 'Set Locator' }).click();
  await ruler.click({ button: 'right', position: { x: bar * 2 + 2, y: 20 } });
  await shell().getByRole('menu', { name: 'Loop' }).getByRole('menuitem', { name: 'Add Locator at 3.1' }).click();
  await expect.poll(locs).toEqual([{ beat: 0, name: '' }, { beat: 8, name: '' }]);
  // Double-click names it.
  await ruler.getByRole('button', { name: 'Locator 2, at 3.1' }).dblclick();
  await ruler.getByRole('textbox', { name: 'Locator name' }).fill('Chorus');
  await ruler.getByRole('textbox', { name: 'Locator name' }).press('Enter');
  await expect.poll(locs).toEqual([{ beat: 0, name: '' }, { beat: 8, name: 'Chorus' }]);
  // Its first click jumped there; Previous and Next step the playhead from one to the other.
  const tools = shell().getByRole('group', { name: 'Locators' });
  await expect(ruler).toHaveAttribute('aria-valuenow', '8');
  await expect(tools.getByRole('button', { name: 'Next Locator' })).toBeDisabled();
  await tools.getByRole('button', { name: 'Previous Locator' }).click();
  await expect(ruler).toHaveAttribute('aria-valuenow', '0');
  await expect(tools.getByRole('button', { name: 'Previous Locator' })).toBeDisabled();
  await tools.getByRole('button', { name: 'Next Locator' }).click();
  await expect(ruler).toHaveAttribute('aria-valuenow', '8');
  await tools.getByRole('button', { name: 'Previous Locator' }).click();
  // Clicking a locator jumps there; dragging it moves it.
  const chorus = ruler.getByRole('button', { name: 'Locator Chorus, at 3.1' });
  await chorus.click();
  await expect(ruler).toHaveAttribute('aria-valuenow', '8');
  const c = (await chorus.boundingBox())!;
  await shell().mouse.move(c.x + 3, c.y + c.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(c.x + 3 + bar, c.y + c.height / 2, { steps: 5 });
  await shell().mouse.up();
  await expect.poll(locs).toEqual([{ beat: 0, name: '' }, { beat: 12, name: 'Chorus' }]);
  // From the first, Loop to Next Locator loops the bars up to the next.
  await ruler.getByRole('button', { name: 'Locator 1, at 1.1' }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Locator 1' }).getByRole('menuitem', { name: 'Loop to Next Locator' }).click();
  await expect(ruler.getByRole('img', { name: 'Loop: bars 1 to 3' })).toBeVisible();
  // Deleted from its menu, and back with one Undo.
  await ruler.getByRole('button', { name: 'Locator Chorus, at 4.1' }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Locator Chorus' }).getByRole('menuitem', { name: 'Delete' }).click();
  await expect.poll(locs).toEqual([{ beat: 0, name: '' }]);
  await ruler.press('Control+z');
  await expect.poll(locs).toEqual([{ beat: 0, name: '' }, { beat: 12, name: 'Chorus' }]);
});

test('an Electric track is a modelled electric piano: tine or reed, its decay, hardness, bell and drive kept in the song', async () => {
  await start();
  await tracks().getByRole('button', { name: 'Add track' }).click();
  await shell().getByRole('menu', { name: 'Add track' }).getByRole('menuitem', { name: 'Electric' }).click();
  await expect.poll(() => saved().tracks.map((t) => [t.name, (t as { instrument?: string }).instrument])).toEqual([['Keys', 'piano'], ['Electric', 'electric']]);
  const device = await openDevice('Electric');
  const piano = device.getByRole('region', { name: 'Electric' });
  // No oscillators or filter: the piano's own settings (Live 12's Electric).
  await expect(device.getByRole('slider', { name: 'Cutoff and resonance' })).toHaveCount(0);
  await expect(piano.getByRole('slider', { name: 'Decay' })).toHaveAttribute('aria-valuetext', '4.0 s');
  await piano.getByRole('combobox', { name: 'Fork' }).click();
  await shell().getByRole('option', { name: 'Reed' }).click();
  await expect(piano).toContainText('electrostatic pickup');
  await piano.getByRole('slider', { name: 'Drive' }).focus();
  await shell().keyboard.press('ArrowUp');
  await expect.poll(() => (saved().tracks[1] as { electric?: unknown }).electric).toEqual({ fork: 'reed', decay: 4, hardness: 0.5, bell: 0.4, drive: 0.36 });
  // Another instrument chosen for the track leaves no piano settings behind.
  await device.getByRole('combobox', { name: 'Instrument' }).click();
  await shell().getByRole('option', { name: 'Lead' }).click();
  await expect.poll(() => (saved().tracks[1] as { electric?: unknown }).electric).toBeUndefined();
});

test('a song takes a time signature: bars, the playhead and the ruler count in it, and 4/4 is written as none', async () => {
  await start();
  const meter = shell().getByRole('group', { name: 'Time signature' });
  await meter.getByRole('spinbutton', { name: 'Beats in a bar' }).fill('3');
  await expect.poll(() => (saved() as { signature?: number[] }).signature).toEqual([3, 4]);
  // A bar on is three beats on: the playhead reads bar 2, beat 1.
  const ruler = shell().getByRole('slider', { name: 'Playhead' });
  await ruler.focus();
  await shell().keyboard.press('ArrowRight');
  await expect(ruler).toHaveAttribute('aria-valuenow', '3');
  await expect(shell().getByRole('status', { name: 'Position' })).toHaveText('2 . 1 . 1');
  // The song is four bars of 3/4: twelve beats.
  await expect(ruler).toHaveAttribute('aria-valuemax', '12');
  // 6/8 counts in eighths: half a beat on is the bar's second.
  await meter.getByRole('spinbutton', { name: 'Beats in a bar' }).fill('6');
  await meter.getByRole('combobox', { name: 'Beat unit' }).click();
  await shell().getByRole('option', { name: '8', exact: true }).click();
  await expect.poll(() => (saved() as { signature?: number[] }).signature).toEqual([6, 8]);
  await expect(shell().getByRole('status', { name: 'Position' })).toHaveText('2 . 1 . 1');
  // Back to 4/4, the song has no signature written.
  await meter.getByRole('spinbutton', { name: 'Beats in a bar' }).fill('4');
  await meter.getByRole('combobox', { name: 'Beat unit' }).click();
  await shell().getByRole('option', { name: '4', exact: true }).click();
  await expect.poll(() => (saved() as { signature?: number[] }).signature).toBeUndefined();
  await expect(ruler).toHaveAttribute('aria-valuemax', '16');
});

test('a melody is written as steps too, a row per note of the key', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, BASS] }));
  await start([], 'Bass');
  await shell().getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Steps' }).click();
  // A minor's notes from the C of the bass's octave: A2 is a row, A#2 is not.
  await expect(shell().getByRole('group', { name: 'A2' })).toBeVisible();
  await expect(shell().getByRole('group', { name: 'A♯2' })).toHaveCount(0);
  await shell().getByRole('group', { name: 'C3' }).getByRole('button', { name: 'C3, step 3', exact: true }).click();
  await expect.poll(() => saved().tracks[1]!.notes.find((n) => n.pitch === 48)).toMatchObject({ start: 0.5 });
  // Another octave shows other rows.
  await shell().getByRole('combobox', { name: 'Range' }).click();
  await shell().getByRole('option', { name: 'C4–C6' }).click();
  await expect(shell().getByRole('group', { name: 'E5' })).toBeVisible();
});

test('draw mode writes a note a grid step long in each step a drag crosses, takes them out from a note, and undoes as one', async () => {
  await start();
  const draw = shell().getByRole('button', { name: 'Draw' });
  await draw.click();
  await expect(draw).toHaveAttribute('aria-pressed', 'true');
  const roll = shell().getByRole('grid', { name: 'Notes of Keys' });
  const box = (await roll.boundingBox())!;
  // Bars 3 and 4, clear of the song's two notes in bar 1.
  const y = box.y + box.height * 0.6;
  const x0 = box.x + box.width * 0.55;
  await shell().mouse.move(x0, y);
  await shell().mouse.down();
  for (let x = x0; x <= x0 + 160; x += 6) await shell().mouse.move(x, y);
  await shell().mouse.up();
  await expect.poll(() => saved().tracks[0]!.notes.length).toBeGreaterThan(6);
  const drawn = saved().tracks[0]!.notes.slice(2);
  // One row, a grid step (1/16) each.
  expect(new Set(drawn.map((n) => n.pitch)).size).toBe(1);
  expect(drawn.every((n) => n.length === 0.25)).toBe(true);
  // From a note, the stroke takes notes out.
  const first = (await roll.locator('.studio-note').filter({ visible: true }).evaluateAll((els, at) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.top <= at && r.bottom >= at).sort((a, b) => a.left - b.left).map((r) => r.left + r.width / 2), y))[0]!;
  await shell().mouse.move(first, y);
  await shell().mouse.down();
  for (let x = first; x <= first + 60; x += 6) await shell().mouse.move(x, y);
  await shell().mouse.up();
  await expect.poll(() => saved().tracks[0]!.notes.length).toBeLessThan(drawn.length + 2);
  // Each stroke is one step back.
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().tracks[0]!.notes.length).toBe(drawn.length + 2);
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().tracks[0]!.notes.length).toBe(2);
  await shell().keyboard.press('b');
  await expect(draw).toHaveAttribute('aria-pressed', 'false');
});

test('picked notes are cut in two, joined back, and their bars looped, from the keyboard', async () => {
  await start();
  const roll = shell().getByRole('grid', { name: 'Notes of Keys' });
  await roll.focus();
  await shell().keyboard.press('Control+a');
  // The playhead is at the start, outside the notes: each is cut at its middle, into two notes of 2 beats.
  await shell().keyboard.press('Control+e');
  await expect.poll(() => saved().tracks[0]!.notes.map((n) => `${n.pitch}@${n.start}+${n.length}`).sort()).toEqual(['57@0+2', '57@2+2', '60@0+2', '60@2+2']);
  await shell().keyboard.press('Control+j');
  await expect.poll(() => saved().tracks[0]!.notes.map((n) => `${n.pitch}@${n.start}+${n.length}`).sort()).toEqual(['57@0+4', '60@0+4']);
  await shell().keyboard.press('Control+l');
  await expect(shell().getByRole('button', { name: 'Loop', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the Transform menu arpeggiates a chord and strums it, each undone', async () => {
  await start();
  const transform = async (row: string) => {
    await shell().getByRole('toolbar', { name: 'Notes' }).getByRole('button', { name: 'Transform' }).click();
    await shell().getByRole('menu', { name: 'Transform' }).getByRole('menuitem', { name: new RegExp(`^${row}`) }).first().click();
  };
  const order = () => saved().tracks[0]!.notes.map((n) => n.pitch);
  // With nothing picked it works on every note: the two-note chord becomes one note at a time, low then high.
  await transform('Arpeggiate up');
  await expect.poll(() => order().slice(0, 4)).toEqual([57, 60, 57, 60]);
  expect(new Set(saved().tracks[0]!.notes.map((n) => n.start)).size).toBe(saved().tracks[0]!.notes.length);
  await shell().getByRole('grid', { name: 'Notes of Keys' }).focus();
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().tracks[0]!.notes.map((n) => `${n.pitch}@${n.start}+${n.length}`)).toEqual(['57@0+4', '60@0+4']);
  // Strum puts the upper note a little after the lower, both still ending on beat 4.
  await transform('Strum');
  await expect.poll(() => saved().tracks[0]!.notes.map((n) => [n.pitch, n.start > 0, n.start + n.length])).toEqual([[57, false, 4], [60, true, 4]]);
});

test('the view switch leads the toolbar: Alt+1 and Alt+2 pick Session or Arrange, Tab on the page swaps them, and Tap sets the tempo', async () => {
  await start();
  const view = (name: string) => shell().getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name });
  await shell().locator('.studio-page').focus();
  await shell().keyboard.press('Alt+1');
  await expect(view('Session')).toHaveAttribute('aria-checked', 'true');
  await shell().keyboard.press('Alt+2');
  await expect(view('Arrange')).toHaveAttribute('aria-checked', 'true');
  await shell().locator('.studio-page').focus();
  await shell().keyboard.press('Tab');
  await expect(view('Session')).toHaveAttribute('aria-checked', 'true');
  // Tapping in time sets the tempo, kept in the song.
  const tap = shell().getByRole('button', { name: 'Tap tempo' });
  for (let i = 0; i < 4; i++) { await tap.click(); await shell().waitForTimeout(400); }
  await expect.poll(() => saved().tempo).not.toBe(112);
});

test('the Library finds a sound by words and tags, puts it on the chosen track or adds an effect, and keeps collections', async () => {
  await start();
  const lib = shell().locator('.studio-library');
  const places = lib.getByRole('navigation', { name: 'Places' });
  await places.getByRole('button', { name: 'All', exact: true }).click();
  const search = lib.getByRole('searchbox', { name: 'Search the library' });
  // Every word must match; #word matches tags only.
  await search.fill('keys soft');
  await expect(lib.locator('.studio-library-name')).toHaveText(['Electric Keys', 'Felt Keys']);
  await search.fill('#pluck');
  await expect(lib.locator('.studio-library-name')).toHaveText(['Mallet', 'Pluck']);
  // A sound onto the chosen melodic track replaces its sound (hot-swap), as one Undo step.
  await search.fill('felt');
  await lib.getByRole('option', { name: 'Felt Keys' }).click();
  await shell().keyboard.press('Enter');
  await expect.poll(() => (saved().tracks[0] as { sound?: { cutoff: number } }).sound?.cutoff).toBe(1800);
  expect(saved().tracks.length).toBe(1);
  // An effect is added to the chosen track.
  await search.fill('reverb');
  await lib.getByRole('option', { name: 'Reverb' }).click();
  await shell().keyboard.press('Enter');
  await expect.poll(() => (saved().tracks[0] as { fx?: { kind: string }[] }).fx?.map((f) => f.kind)).toEqual(['reverb']);
  // 3 puts the chosen item in the third collection, which then lists only it.
  await shell().keyboard.press('3');
  await search.fill('');
  await places.getByRole('button', { name: /\(collection 3\)$/ }).click();
  await expect(lib.locator('.studio-library-name')).toHaveText(['Reverb']);
});

test('the Mixer opens beside the Detail with a strip per track: the fader and Mute change the track in the song', async () => {
  await start();
  await shell().getByRole('button', { name: 'Mixer', exact: true }).click();
  const mixer = shell().getByRole('region', { name: 'Mixer' });
  await expect(mixer.getByRole('slider', { name: 'Keys volume' })).toBeVisible();
  const fader = mixer.getByRole('slider', { name: 'Keys volume' });
  const before = Number(await fader.getAttribute('aria-valuenow'));
  await fader.focus();
  // Page Down takes 6 dB off: about half the gain.
  await shell().keyboard.press('PageDown');
  await expect(fader).toHaveAttribute('aria-valuenow', String(Math.round((before - 6) * 10) / 10));
  await expect.poll(() => saved().tracks.find((t) => t.name === 'Keys')!.volume).toBeLessThan(0.6);
  await mixer.getByRole('button', { name: 'Mute Keys' }).click();
  await expect.poll(() => (saved().tracks[0] as { muted?: boolean }).muted).toBe(true);
});

test('a return track gets a Send knob on every track, and Main has its own fader (Live\'s Mixer)', async () => {
  await start();
  await shell().getByRole('button', { name: 'Mixer', exact: true }).click();
  const mixer = shell().getByRole('region', { name: 'Mixer' });
  await mixer.getByRole('button', { name: 'Add return' }).click();
  await expect(mixer.getByRole('group', { name: 'A Return' })).toBeVisible();
  await expect.poll(() => (saved() as unknown as { returns?: { id: string }[] }).returns?.length).toBe(1);
  const id = (saved() as unknown as { returns: { id: string }[] }).returns[0]!.id;
  expect(saved().tracks.some((t) => (t as { id: string }).id === id)).toBe(false);
  // Keys' Send to A, turned up, sends to it; Main's fader, pulled down, is kept in the song.
  const send = mixer.getByRole('group', { name: 'Keys sends' }).getByRole('slider', { name: 'Send to A', exact: true });
  await send.focus();
  await shell().keyboard.press('PageUp');
  await expect.poll(() => (saved().tracks.find((t) => t.name === 'Keys') as { sends?: Record<string, number> }).sends?.[id] ?? 0).toBeGreaterThan(0);
  const main = mixer.getByRole('slider', { name: 'Main volume' });
  await main.focus();
  await shell().keyboard.press('PageDown');
  await expect.poll(() => (saved() as unknown as { main?: { volume: number } }).main?.volume ?? 0.8).toBeLessThan(0.5);
});

test('Record plays from the playhead and writes what is played on the computer keyboard into the track, undone as one take', async () => {
  await start();
  // Wide enough that the Computer keyboard button stays in the toolbar rather than the ⋯ menu.
  await resizeWindow(mobius!.app, 1600, 900);
  const rec = shell().getByRole('button', { name: 'Record' });
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');
  await expect(shell().getByRole('button', { name: 'Computer keyboard' })).toHaveAttribute('aria-pressed', 'true');
  // A bar of ticks counts in first: the song is not playing yet, then it plays from the playhead.
  await expect(shell().getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(shell().getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });
  // A plays C4 and H plays A4, each held a moment, once the playhead has moved off the song's own notes' start.
  await shell().waitForTimeout(400);
  await shell().keyboard.down('a');
  await shell().waitForTimeout(300);
  await shell().keyboard.up('a');
  await shell().keyboard.down('h');
  await shell().waitForTimeout(300);
  await shell().keyboard.up('h');
  await shell().getByRole('button', { name: 'Pause' }).click();
  await expect(rec).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => saved().tracks[0]!.notes.map((n) => n.pitch).sort()).toEqual([57, 60, 60, 69]);
  const played = saved().tracks[0]!.notes.filter((n) => n.length < 4);
  expect(played.every((n) => n.length > 0.1 && n.velocity > 0.7)).toBe(true);
  await shell().locator('.studio-page').focus();
  await shell().keyboard.press('Control+z');
  await expect.poll(() => saved().tracks[0]!.notes).toHaveLength(2);
});

test('an audio clip in the Detail panel: Warp, its mode, and a Pitch heard only in a mode that keeps pitch', async () => {
  const take = { id: 'a1', start: 0, length: 4, name: 'Take', notes: [], audio: { file: 'Samples/take.wav' } };
  const VOX = { id: 't2', name: 'Vox', kind: 'audio', instrument: 'piano', volume: 0.8, pan: 0, muted: false, solo: false, color: 'teal', clips: [take] };
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, VOX] }));
  await start();
  await tracks().getByRole('listitem', { name: 'Vox' }).getByRole('button', { name: /^Take, .*audio/ }).dblclick();
  const detail = shell().getByRole('group', { name: 'Audio clip Take' });
  await expect(detail).toBeVisible();
  const pitch = detail.getByRole('slider', { name: 'Pitch' });
  // Unwarped, and then in Re-Pitch, its Pitch is not heard, so it can't be set.
  await expect(pitch).toHaveAttribute('aria-disabled', 'true');
  await detail.getByRole('switch', { name: 'Warp' }).click();
  await expect(pitch).toHaveAttribute('aria-disabled', 'true');
  await detail.getByRole('combobox', { name: 'Warp mode' }).click();
  await shell().getByRole('option', { name: 'Complex', exact: true }).click();
  await pitch.focus();
  await shell().keyboard.press('ArrowUp');
  await shell().keyboard.press('ArrowUp');
  const audio = () => ((saved().tracks[1] as { clips: { audio?: unknown }[] }).clips[0]!.audio);
  await expect.poll(audio).toEqual({ file: 'Samples/take.wav', warp: true, mode: 'complex', transpose: 2 });
  // Its clip envelopes offer Transposition (27.2.2).
  await detail.getByRole('combobox', { name: 'Envelope' }).click();
  await expect(shell().getByRole('option', { name: 'Transposition', exact: true })).toBeVisible();
});

test('an audio track arms with its Arm button, not by being chosen, and Record asks for it first', async () => {
  const VOX = { id: 't2', name: 'Vox', kind: 'audio', instrument: 'piano', volume: 0.8, pan: 0, muted: false, solo: false, color: 'teal', notes: [], clips: [] };
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [...SONG.tracks, VOX] }));
  await start();
  await resizeWindow(mobius!.app, 1600, 900);
  const vox = tracks().getByRole('listitem', { name: 'Vox' });
  await vox.locator('.studio-lane').click({ position: { x: 4, y: 4 } });
  const arm = vox.getByRole('button', { name: 'Arm Vox' });
  await expect(arm).toHaveAttribute('aria-pressed', 'false');
  // Chosen but not armed: Record says to arm it and doesn't start.
  const rec = shell().getByRole('button', { name: 'Record' });
  await rec.click();
  await expect(shell().getByText('Arm Vox to record its input.')).toBeVisible();
  await expect(rec).toHaveAttribute('aria-pressed', 'false');
  await arm.click();
  await expect(arm).toHaveAttribute('aria-pressed', 'true');
  await arm.click();
  await expect(arm).toHaveAttribute('aria-pressed', 'false');
  // A MIDI track has no Arm button: choosing it arms it.
  await expect(tracks().getByRole('listitem', { name: 'Keys' }).getByRole('button', { name: 'Arm Keys' })).toHaveCount(0);
});

test('the song tempo changes along a line on Main: the playhead reads it, and Clear takes it away', async () => {
  await start();
  await resizeWindow(mobius!.app, 1600, 900);
  type Main = { main?: { auto?: { tempo?: { beat: number; value: number }[] } } };
  const line = () => (saved() as Main).main?.auto?.tempo;
  await shell().getByRole('button', { name: 'Automation' }).click();
  const lane = tracks().getByRole('listitem', { name: 'Main' }).getByRole('group', { name: 'Song Tempo automation' });
  await expect(lane).toBeVisible();
  // Two points: slow at the start, fast at the end (the lane runs 30 to 300 bpm).
  const plot = lane.locator('.ui-lane-plot');
  const box = (await plot.boundingBox())!;
  await plot.click({ position: { x: 2, y: box.height * 0.85 } });
  await expect.poll(() => line()?.length).toBe(1);
  await plot.click({ position: { x: box.width - 2, y: box.height * 0.2 } });
  await expect.poll(() => line()?.length).toBe(2);
  const [a, b] = line()!;
  expect(a!.value).toBeLessThan(b!.value);
  expect(a!.value).toBeGreaterThanOrEqual(30);
  expect(b!.value).toBeLessThanOrEqual(300);
  // The tempo readout follows the line where the playhead is: the first point's tempo at the start.
  const tempo = shell().getByRole('spinbutton', { name: 'Tempo' });
  await expect(tempo).toHaveValue(String(Math.round(a!.value)));
  await expect(tempo).toHaveAttribute('readonly', '');
  // Clear takes the line away and the song's own tempo is back.
  await tracks().getByRole('listitem', { name: 'Main' }).getByRole('button', { name: 'Clear' }).click();
  await expect.poll(line).toBeUndefined();
  await expect(tempo).toHaveValue('112');
});

test('automation draws a volume or pan line under a track with points, kept in the song', async () => {
  await start();
  // Wide enough that the Automation button stays in the toolbar rather than the ⋯ menu.
  await resizeWindow(mobius!.app, 1600, 900);
  await shell().getByRole('button', { name: 'Automation' }).click();
  const lane = tracks().getByRole('listitem', { name: 'Keys' }).getByRole('group', { name: 'Volume automation' });
  await expect(lane).toBeVisible();
  // Clicks on the plot itself, which waits for the lane to finish opening (a box read early can miss it).
  const plot = lane.locator('.ui-lane-plot');
  const box = (await plot.boundingBox())!;
  await plot.click({ position: { x: box.width * 0.25, y: box.height * 0.8 } });
  await expect.poll(() => saved().tracks[0]!.auto?.volume?.length).toBe(1);
  await plot.click({ position: { x: box.width * 0.75, y: box.height * 0.2 } });
  await expect.poll(() => saved().tracks[0]!.auto?.volume?.length).toBe(2);
  const [a, b] = saved().tracks[0]!.auto!.volume!;
  expect(a!.beat).toBeLessThan(b!.beat);
  expect(a!.value).toBeLessThan(b!.value);
  // The lane's name chooses the setting it moves: Pan runs -1 (left) to 1, so a low click pans left.
  await tracks().getByRole('listitem', { name: 'Keys' }).getByRole('button', { name: /automation: Volume/ }).click();
  await shell().getByRole('menuitemcheckbox', { name: /^Pan/ }).click();
  const pan = tracks().getByRole('listitem', { name: 'Keys' }).getByRole('group', { name: 'Pan automation' }).locator('.ui-lane-plot');
  await pan.click({ position: { x: box.width * 0.5, y: box.height * 0.9 } });
  await expect.poll(() => saved().tracks[0]!.auto?.pan?.[0]?.value ?? 0).toBeLessThan(-0.5);
  // A hides the lines again; the points stay.
  await shell().locator('.studio-page').focus();
  await shell().keyboard.press('a');
  await expect(lane).toHaveCount(0);
});

test('a clip envelope moves the open clip’s volume or pan in its own beats, kept with the clip', async () => {
  await start();
  await openNotes('Keys');
  const env = shell().getByRole('group', { name: /^Envelopes of / });
  const plot = env.getByRole('group', { name: 'Volume envelope automation' }).locator('.ui-lane-plot');
  const box = (await plot.boundingBox())!;
  await plot.click({ position: { x: box.width * 0.1, y: box.height * 0.8 } });
  const envelopes = () => (saved().tracks[0]!.clips?.[0] as { envelopes?: Record<string, { beat: number; value: number }[]> } | undefined)?.envelopes;
  await expect.poll(() => envelopes()?.volume?.length).toBe(1);
  expect(envelopes()!.volume![0]!.value).toBeLessThan(0.5);
  // Its name chooses the setting: Pan is added to the track's, -1 (left) to 1.
  await env.getByRole('button', { name: /envelope: Volume/ }).click();
  await shell().getByRole('menuitemcheckbox', { name: /^Pan/ }).click();
  await env.getByRole('group', { name: 'Pan envelope automation' }).locator('.ui-lane-plot').click({ position: { x: box.width * 0.1, y: box.height * 0.1 } });
  await expect.poll(() => envelopes()?.pan?.[0]?.value ?? 0).toBeGreaterThan(0.5);
});

test('a clip envelope moves an effect setting, and an unlinked one keeps its own loop, kept with the clip', async () => {
  fs.writeFileSync(file(), JSON.stringify({ ...SONG, tracks: [{ ...SONG.tracks[0], fx: [{ id: 'fx1', kind: 'reverb', on: true, size: 2, damp: 0.4, mix: 0.25 }] }] }));
  await start();
  await openNotes('Keys');
  const env = shell().getByRole('group', { name: /^Envelopes of / });
  await env.getByRole('button', { name: /envelope: Volume/ }).click();
  await shell().getByRole('menuitemcheckbox', { name: /^Reverb Mix/ }).click();
  const plot = env.getByRole('group', { name: 'Reverb Mix envelope automation' }).locator('.ui-lane-plot');
  const box = (await plot.boundingBox())!;
  await plot.click({ position: { x: box.width * 0.1, y: box.height * 0.1 } });
  const clip = () => saved().tracks[0]!.clips?.[0] as { envelopes?: Record<string, { value: number }[]>; unlinked?: Record<string, { start: number; end: number }> } | undefined;
  await expect.poll(() => clip()?.envelopes?.['fx:fx1:mix']?.[0]?.value ?? 0).toBeGreaterThan(0.5);
  // Unlinked, it goes round a loop of its own, from the clip's start.
  await env.getByRole('button', { name: /envelope: Reverb Mix/ }).click();
  await shell().getByRole('menuitemcheckbox', { name: 'Unlink Reverb Mix from the clip' }).click();
  await expect.poll(() => clip()?.unlinked?.['fx:fx1:mix']?.start).toBe(0);
  await expect(env.getByRole('group', { name: 'Reverb Mix envelope loop' })).toBeVisible();
  await env.getByRole('button', { name: /envelope: Reverb Mix/ }).click();
  await shell().getByRole('menuitemcheckbox', { name: 'Unlink Reverb Mix from the clip' }).click();
  await expect.poll(() => clip()?.unlinked).toBeUndefined();
});

test('Export as WAV renders the song and saves it in the Exports folder', async () => {
  await start();
  // Wide enough that Export stays in the toolbar rather than the ⋯ menu (it is the first control to drop).
  await resizeWindow(mobius!.app, 1600, 900);
  // Export is Live's Rendered Track: Main, or every track on its own.
  await shell().getByRole('button', { name: 'Export' }).click();
  await shell().getByRole('menu', { name: 'Export' }).getByRole('menuitem', { name: /^Export Main as WAV/ }).click();
  await expect(shell().getByRole('status').filter({ hasText: 'Exported “Night Drive.wav” to Exports' })).toBeVisible({ timeout: 30_000 });
  const wav = fs.readFileSync(path.join(userData, 'workspace', 'Exports', 'Night Drive.wav'));
  expect(wav.subarray(0, 4).toString('latin1')).toBe('RIFF');
  expect(wav.subarray(8, 12).toString('latin1')).toBe('WAVE');
  // Rendered by the engine (silent on a computer with no sound output): four bars at 112 bpm plus a two-second tail,
  // 32-bit float stereo at 44.1 kHz.
  expect(wav.readUInt16LE(20)).toBe(3);
  expect(wav.length).toBe(44 + Math.ceil((16 * 60 / 112 + 2) * 44100) * 8);
  // A second export never writes over the first.
  await shell().getByRole('status').filter({ hasText: 'Exported' }).getByRole('button', { name: 'Dismiss' }).click();
  await shell().locator('.studio-page').focus();
  await shell().keyboard.press('Control+Shift+E');
  await expect(shell().getByRole('status').filter({ hasText: 'Exported “Night Drive 2.wav” to Exports' })).toBeVisible({ timeout: 30_000 });
});

test('Export can render every track on its own, the same length, into a stems folder', async () => {
  await start();
  await resizeWindow(mobius!.app, 1600, 900);
  await shell().getByRole('button', { name: 'Export' }).click();
  await shell().getByRole('menu', { name: 'Export' }).getByRole('menuitem', { name: /^Export All Tracks as WAVs/ }).click();
  await expect(shell().getByRole('status').filter({ hasText: /Exported \d+ tracks? to Exports\/Night Drive stems/ })).toBeVisible({ timeout: 30_000 });
  const folder = path.join(userData, 'workspace', 'Exports', 'Night Drive stems');
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.wav'));
  expect(files.length).toBeGreaterThanOrEqual(2);
  // All the same length, as Live renders them, so they line up when brought back in.
  const sizes = new Set(files.map((f) => fs.statSync(path.join(folder, f)).size));
  expect(sizes.size).toBe(1);
});

test('the computer keyboard plays notes, an octave and velocity at a time, shown on the roll keys while held', async () => {
  await start();
  // Wide enough that the Computer keyboard button stays in the toolbar rather than the ⋯ menu.
  await resizeWindow(mobius!.app, 1600, 900);
  const play = shell().getByRole('button', { name: 'Computer keyboard' });
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect(shell().getByRole('status').filter({ hasText: 'Computer keyboard from C4, velocity 100' })).toBeAttached();
  // X goes up an octave and C down a velocity step; A plays C, H plays A.
  await shell().keyboard.press('x');
  await shell().keyboard.press('c');
  await expect(shell().getByRole('status').filter({ hasText: 'Computer keyboard from C5, velocity 80' })).toBeAttached();
  await shell().keyboard.down('h');
  await expect(shell().locator('.studio-key[data-on]')).toHaveText('A5');
  await shell().keyboard.up('h');
  await expect(shell().locator('.studio-key[data-on]')).toHaveCount(0);
  // Playing is not writing: the song is as it was.
  expect(saved().tracks[0]!.notes).toHaveLength(2);
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
  // The notes are the bottom panel: its edge gives them more room from the keyboard, and a double-click puts it back.
  const edge = shell().getByRole('separator', { name: 'Resize the panels at the bottom' });
  const fit = Number(await edge.getAttribute('aria-valuenow'));
  await edge.focus();
  await shell().keyboard.press('ArrowUp');
  await expect(edge).toHaveAttribute('aria-valuenow', String(fit + 16));
  await edge.dblclick();
  await expect(edge).toHaveAttribute('aria-valuenow', String(fit));
  // Drums get rows tall enough to name each drum in full.
  await tracks().getByRole('listitem', { name: 'Bass' }).click();
  await addTrack('Drums');
  const head = shell().getByRole('grid', { name: 'Notes of Drums' }).getByRole('rowheader', { name: 'Closed hat' });
  expect((await head.boundingBox())!.height).toBeGreaterThanOrEqual(26);
});

test('the loop goes round bars picked on the ruler, and a track has a menu', async () => {
  await start();
  await resizeWindow(mobius!.app, 1440, 900);
  // Dragging along the top of the ruler from bar 2 to bar 3 loops those bars; the ruler's menu loops the whole song again.
  const ruler = shell().getByRole('slider', { name: 'Playhead' });
  const r = (await ruler.boundingBox())!;
  // The arrangement fits the song across the window, so a bar is a quarter of this four-bar song's ruler.
  const bar = r.width / 4;
  await shell().mouse.move(r.x + bar * 1.5, r.y + 4);
  await shell().mouse.down();
  await shell().mouse.move(r.x + bar * 2.5, r.y + 4, { steps: 4 });
  await shell().mouse.up();
  await expect(ruler.getByRole('img', { name: 'Loop: bars 2 to 3' })).toBeVisible();
  await ruler.click({ button: 'right', position: { x: bar * 0.5, y: 16 } });
  await shell().getByRole('menu', { name: 'Loop' }).getByRole('menuitem', { name: 'Loop Whole Song' }).click();
  await expect(ruler.getByRole('img', { name: 'Loop: the whole song' })).toBeVisible();
  // A right-click on a track's header offers what its buttons do.
  await tracks().getByRole('listitem', { name: 'Keys' }).getByRole('textbox', { name: 'Track name' }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Keys' }).getByRole('menuitem', { name: 'Solo' }).click();
  await expect.poll(() => (saved().tracks[0] as { solo?: boolean }).solo).toBe(true);
  // The menu's keys work on the chosen track, and its colour is the person's to pick. The menu is gone before the track
  // is clicked (while it closes, it can take the click), and the track has the focus before M is pressed.
  await expect(shell().getByRole('menu', { name: 'Keys' })).toHaveCount(0);
  await tracks().getByRole('listitem', { name: 'Keys' }).click({ position: { x: 6, y: 6 } });
  await expect(tracks().getByRole('listitem', { name: 'Keys' })).toBeFocused();
  await shell().keyboard.press('m');
  await expect.poll(() => (saved().tracks[0] as { muted?: boolean }).muted).toBe(true);
  await (await openDevice('Keys')).getByRole('radio', { name: 'Coral' }).click();
  await expect.poll(() => (saved().tracks[0] as { color?: string }).color).toBe('coral');
  await tracks().getByRole('listitem', { name: 'Keys' }).getByRole('textbox', { name: 'Track name' }).click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Keys' }).getByRole('menuitem', { name: 'Delete Track' }).click();
  await expect.poll(() => saved().tracks.length).toBe(0);
  // Deleting says what went, with Undo to bring it back.
  await shell().getByRole('status').filter({ hasText: 'Deleted “Keys”' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => saved().tracks.map((t) => t.name)).toEqual(['Keys']);
  // The row after the last track adds one.
  await tracks().getByRole('button', { name: 'Add track' }).click();
  await shell().getByRole('menu', { name: 'Add track' }).getByRole('menuitem', { name: 'Lead' }).click();
  await expect.poll(() => saved().tracks.map((t) => t.name)).toEqual(['Keys', 'Lead']);
});

test('Loop on a clip in Arrange repeats it when it is stretched, as Live\'s Loop switch does', async () => {
  await start();
  await resizeWindow(mobius!.app, 1440, 900);
  const ruler = shell().getByRole('slider', { name: 'Playhead' });
  await ruler.click({ button: 'right' });
  await shell().getByRole('menu').getByRole('menuitem', { name: 'Add 4 Bars' }).click();
  const bar = (await ruler.boundingBox())!.width / 8;
  const clip = () => shell().getByRole('button', { name: /^Keys, bar/ }).first();
  await clip().click({ button: 'right' });
  await shell().getByRole('menu').getByRole('menuitem', { name: 'Loop', exact: true }).click();
  await expect(clip()).toHaveAccessibleName('Keys, bar 1, looped');
  await expect.poll(() => (saved().tracks[0]!.clips?.[0] as { loop?: unknown } | undefined)?.loop).toEqual({ start: 0, end: 4 });
  // Stretched a bar, it plays its bar twice: the notes are kept once, and the second pass is drawn after a notch.
  const b = (await clip().boundingBox())!;
  await shell().mouse.move(b.x + b.width - 2, b.y + b.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(b.x + b.width - 2 + bar, b.y + b.height / 2, { steps: 6 });
  await shell().mouse.up();
  await expect(clip()).toHaveAccessibleName('Keys, bars 1 to 2, looped');
  await expect.poll(() => saved().tracks[0]!.clips?.[0]?.length).toBe(8);
  expect(saved().tracks[0]!.notes).toHaveLength(2);
  await expect(clip().locator('.studio-clip-turn')).toHaveCount(1);
  // Ctrl+Down halves the loop (Live's Clip View): half a bar, four passes. Opened, the Clip toolbar shows the loop.
  await clip().focus();
  await shell().keyboard.press('Control+ArrowDown');
  await expect.poll(() => (saved().tracks[0]!.clips?.[0] as { loop?: unknown } | undefined)?.loop).toEqual({ start: 0, end: 2 });
  await expect(clip().locator('.studio-clip-turn')).toHaveCount(3);
  await clip().press('Enter');
  const loop = shell().getByRole('group', { name: /^Loop of / });
  await expect(loop.getByRole('button', { name: 'Loop clip' })).toHaveAttribute('aria-pressed', 'true');
  await expect(loop.getByRole('spinbutton', { name: 'Loop length', exact: true })).toHaveAttribute('aria-valuenow', '2');
  // The start marker: Up moves it a quarter beat into the clip.
  await loop.getByRole('spinbutton', { name: 'Start', exact: true }).press('ArrowUp');
  await expect.poll(() => (saved().tracks[0]!.clips?.[0] as { offset?: number } | undefined)?.offset).toBe(0.25);
  // Stop Looping takes the loop off; the clip stays as long, and what's past its notes is quiet.
  await clip().click({ button: 'right' });
  await shell().getByRole('menu').getByRole('menuitem', { name: 'Stop Looping' }).click();
  await expect(clip()).toHaveAccessibleName('Keys, bars 1 to 2');
  await expect.poll(() => (saved().tracks[0]!.clips?.[0] as { loop?: unknown; length?: number } | undefined)?.length === 8 && !(saved().tracks[0]!.clips?.[0] as { loop?: unknown }).loop).toBe(true);
});

test('a clip in Arrange is moved and stretched by dragging, muted with 0, copied with Ctrl+D and deleted, each undone', async () => {
  await start();
  await resizeWindow(mobius!.app, 1440, 900);
  // The four-bar song's notes are one clip, bar 1; the song is made eight bars so there is room to move it.
  const ruler = shell().getByRole('slider', { name: 'Playhead' });
  await ruler.click({ button: 'right' });
  await shell().getByRole('menu').getByRole('menuitem', { name: 'Add 4 Bars' }).click();
  const r = (await ruler.boundingBox())!;
  const bar = r.width / 8;
  const clip = () => shell().getByRole('button', { name: /^Keys, bar/ }).first();
  await expect(clip()).toHaveAccessibleName('Keys, bar 1');
  // Dragged two bars right, it lands on bar 3, its notes going with it.
  let b = (await clip().boundingBox())!;
  await shell().mouse.move(b.x + 10, b.y + b.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(b.x + 10 + bar * 2, b.y + b.height / 2, { steps: 6 });
  await shell().mouse.up();
  await expect(clip()).toHaveAccessibleName('Keys, bar 3');
  await expect.poll(() => saved().tracks[0]!.clips?.map((c) => [c.start, c.length])).toEqual([[8, 4]]);
  expect(saved().tracks[0]!.notes.map((n) => n.start)).toEqual([8, 8]);
  // Its right edge, dragged a bar further, makes it two bars long.
  b = (await clip().boundingBox())!;
  await shell().mouse.move(b.x + b.width - 2, b.y + b.height / 2);
  await shell().mouse.down();
  await shell().mouse.move(b.x + b.width - 2 + bar, b.y + b.height / 2, { steps: 6 });
  await shell().mouse.up();
  await expect(clip()).toHaveAccessibleName('Keys, bars 3 to 4');
  // 0 mutes it (kept, not played), Ctrl+D copies it straight after, Delete takes the copy out; Undo goes back a step.
  await clip().focus();
  await shell().keyboard.press('0');
  await expect(clip()).toHaveAccessibleName('Keys, bars 3 to 4, muted');
  await expect.poll(() => saved().tracks[0]!.clips?.[0]?.muted).toBe(true);
  await shell().keyboard.press('Control+d');
  await expect(shell().getByRole('button', { name: /^Keys, bar/ })).toHaveCount(2);
  await shell().getByRole('button', { name: 'Keys, bars 5 to 6, muted' }).focus();
  await shell().keyboard.press('Delete');
  await expect(shell().getByRole('button', { name: /^Keys, bar/ })).toHaveCount(1);
  await shell().locator('.studio-page').focus();
  await shell().keyboard.press('Control+z');
  await expect(shell().getByRole('button', { name: /^Keys, bar/ })).toHaveCount(2);
});

test('Freeze renders a track and plays that in its place, locking its clips and devices until Unfreeze', async () => {
  await start();
  const keys = tracks().getByRole('listitem', { name: 'Keys' });
  await keys.getByRole('textbox', { name: 'Track name' }).click({ button: 'right' });
  await shell().getByRole('menuitem', { name: 'Freeze Track' }).click();
  // The render is kept in the song's folder, and the track says it is frozen.
  await expect.poll(() => (saved().tracks[0] as { frozen?: { file: string } }).frozen?.file, { timeout: 30_000 }).toMatch(/^Samples\/Processed\/Freeze\/.+\.wav$/);
  const render = path.join(path.dirname(file()), (saved().tracks[0] as unknown as { frozen: { file: string } }).frozen.file);
  expect(fs.readFileSync(render).subarray(0, 4).toString('latin1')).toBe('RIFF');
  await expect(keys.getByText('Frozen', { exact: true })).toBeVisible();
  // Its notes can't be opened while frozen; it says why.
  await keys.getByRole('textbox', { name: 'Track name' }).click({ button: 'right' });
  await expect(shell().getByRole('menuitem', { name: 'Edit Notes' })).toBeDisabled();
  await shell().getByRole('menuitem', { name: 'Unfreeze Track' }).click();
  await expect.poll(() => (saved().tracks[0] as { frozen?: unknown }).frozen).toBeUndefined();
  await expect(keys.getByText('Frozen', { exact: true })).toHaveCount(0);
});

/** A short WAV (16-bit mono, 48 kHz) of `seconds` of a quiet tone, for samples. */
function wav(seconds: number): Buffer {
  const rate = 48_000;
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 8000), 44 + i * 2);
  return b;
}

test('the Library lists the song’s samples, and one put on the song becomes a Sampler track that plays it', async () => {
  const samples = path.join(path.dirname(file()), 'Samples');
  fs.mkdirSync(samples, { recursive: true });
  fs.writeFileSync(path.join(samples, 'Pluck.wav'), wav(0.5));
  await start();
  const lib = shell().locator('.studio-library');
  await lib.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Samples in this song' }).click();
  // Its text says what's wrong if it can't list them.
  await expect(lib.getByRole('listbox', { name: 'Samples' })).toContainText('Pluck');
  const row = lib.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /Pluck/ });
  // On a track that isn't a sampler, Enter adds a Sampler track for it, named by it.
  await row.click();
  await shell().keyboard.press('Enter');
  await expect.poll(() => (saved().tracks as unknown as { kind?: string; name: string; sampler?: { file: string } }[]).find((t) => t.kind === 'sampler')).toMatchObject({ name: 'Pluck', sampler: { file: 'Samples/Pluck.wav' } });
});
