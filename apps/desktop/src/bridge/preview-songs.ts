import { writeSong, type Song } from '../song-format';

/** The preview's Studio: songs kept in memory while the preview is open, so Studio can be used without the Rust core. */
const now = Date.now();
const chord = (pitches: number[], start: number, length = 4, velocity = 0.6) => pitches.map((pitch) => ({ pitch, start, length, velocity }));
const DAY = 86_400_000;
const bars = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
/** A song in D minor at 92 bpm, laid out like the Music mock: a beat all through, a bass line, chords, a hook and a pad. */
const NIGHT: Song = {
  version: 1, tempo: 92, key: 'D minor', bars: 24,
  tracks: [
    { id: 't1', name: 'Drums', instrument: 'drums', color: 'amber', volume: 0.8, muted: false, solo: false, notes: bars(0, 24).flatMap((bar) => [0, 1, 2, 3].flatMap((b) => { const at = bar * 4 + b; return [{ pitch: b % 2 === 0 ? 36 : 38, start: at, length: 0.25, velocity: 0.9 }, { pitch: 42, start: at, length: 0.25, velocity: 0.5 }, { pitch: 42, start: at + 0.5, length: 0.25, velocity: 0.35 }]; })) },
    { id: 't2', name: 'Bass', instrument: 'bass', color: 'blue', volume: 0.8, muted: false, solo: false, notes: [...bars(4, 12), ...bars(16, 24)].flatMap((bar) => { const root = [38, 34, 41, 36][bar % 4]!; return [{ pitch: root, start: bar * 4, length: 1.5, velocity: 0.9 }, { pitch: root, start: bar * 4 + 2.5, length: 1, velocity: 0.7 }, { pitch: root + 12, start: bar * 4 + 3.5, length: 0.5, velocity: 0.6 }]; }) },
    { id: 't3', name: 'Keys', instrument: 'piano', color: 'green', volume: 0.7, muted: false, solo: false, notes: [...bars(0, 8), ...bars(12, 20)].flatMap((bar) => chord([[62, 65, 69], [58, 62, 65], [65, 69, 72], [60, 64, 67]][bar % 4]!, bar * 4)) },
    { id: 't4', name: 'Lead', instrument: 'lead', color: 'violet', volume: 0.6, muted: false, solo: false, notes: bars(8, 16).flatMap((bar) => [[74, 0, 1], [72, 1, 0.5], [70, 1.5, 0.5], [69, 2, 2]].map(([pitch, at, length]) => ({ pitch: pitch! + (bar % 2 === 0 ? 0 : -2), start: bar * 4 + at!, length: length!, velocity: 0.75 }))) },
    { id: 't5', name: 'Pad idea', instrument: 'pad', color: 'teal', volume: 0.6, muted: false, solo: false, sound: { shape: 0.35, detune: 12, cutoff: 1200, resonance: 0.22, attack: 0.84, release: 2.1 }, notes: bars(12, 24).flatMap((bar) => chord([[50, 57, 62], [46, 53, 58], [53, 60, 65], [48, 55, 60]][bar % 4]!, bar * 4, 4, 0.5)) },
  ],
};
/** Night Drive before Mobius's last turn added the pad, so the preview shows that pad dashed, to keep or discard. */
export const PREVIEW_NIGHT_BEFORE = writeSong({ ...NIGHT, tracks: NIGHT.tracks.slice(0, 4) });
const SKETCH: Song = { version: 1, tempo: 120, key: 'A minor', bars: 8, tracks: [NIGHT.tracks[0]!].map((t) => ({ ...t, notes: t.notes.filter((n) => n.start < 32) })) };
const TEXT: Record<string, string> = {
  'Songs/Night Drive.json': writeSong(NIGHT),
  'Songs/Offsite reel.json': writeSong({ ...NIGHT, tempo: 104, key: 'A minor', bars: 16, tracks: NIGHT.tracks.slice(0, 3).map((t) => ({ ...t, notes: t.notes.filter((n) => n.start < 64) })) }),
  'Songs/Sketch 14.json': writeSong(SKETCH),
};
const MODIFIED: Record<string, number> = { 'Songs/Night Drive.json': now - 3_600_000, 'Songs/Offsite reel.json': now - 3 * DAY, 'Songs/Sketch 14.json': now - 10 * DAY };
const title = (path: string) => path.slice(path.indexOf('/') + 1, -5);

export const PREVIEW_SONGS: Record<string, (...args: never[]) => unknown> = {
  'songs.list': () => [{ name: 'Songs', pages: Object.keys(TEXT).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now })).sort((a, b) => b.modified - a.modified) }],
  'songs.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : { ok: false, message: 'that song is not there' })) as never,
  'songs.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'songs.createPage': ((folder: string, name?: string) => {
    const path = `${folder}/${(name ?? '').trim() || 'Untitled'}.json`;
    TEXT[path] = writeSong({ version: 1, tempo: 112, key: 'C major', bars: 8, tracks: [] });
    MODIFIED[path] = Date.now();
    return { path, content: TEXT[path], modified: MODIFIED[path] };
  }) as never,
  'songs.remove': ((path: string) => { delete TEXT[path]; return { path }; }) as never,
};
