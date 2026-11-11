import { writeSong, type Song } from '../song-format';

/** The preview's Studio: songs kept in memory while the preview is open, so Studio can be used without the Rust core. */
const now = Date.now();
const chord = (pitches: number[], start: number, length = 4, velocity = 0.6) => pitches.map((pitch) => ({ pitch, start, length, velocity }));
const SONG: Song = {
  version: 1, tempo: 104, key: 'A minor', bars: 8,
  tracks: [
    { id: 't1', name: 'Keys', instrument: 'piano', volume: 0.8, muted: false, solo: false, notes: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((bar) => chord([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]][bar % 4]!, bar * 4)) },
    { id: 't2', name: 'Bass', instrument: 'bass', volume: 0.8, muted: false, solo: false, notes: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((bar) => { const root = [45, 41, 36, 43][bar % 4]!; return [{ pitch: root, start: bar * 4, length: 1.5, velocity: 0.9 }, { pitch: root, start: bar * 4 + 2.5, length: 1, velocity: 0.7 }, { pitch: root + 12, start: bar * 4 + 3.5, length: 0.5, velocity: 0.6 }]; }) },
    { id: 't3', name: 'Drums', instrument: 'drums', volume: 0.8, muted: false, solo: false, notes: Array.from({ length: 32 }, (_, b) => [{ pitch: b % 2 === 0 ? 36 : 38, start: b, length: 0.25, velocity: 0.9 }, { pitch: 42, start: b, length: 0.25, velocity: 0.5 }, { pitch: 42, start: b + 0.5, length: 0.25, velocity: 0.35 }]).flat() },
    { id: 't4', name: 'Lead', instrument: 'lead', volume: 0.6, muted: false, solo: false, notes: [[76, 16, 1], [74, 17, 0.5], [72, 17.5, 0.5], [71, 18, 2], [72, 20, 1], [74, 21, 1], [76, 22, 2], [79, 24, 1.5], [77, 25.5, 0.5], [76, 26, 2], [74, 28, 4]].map(([pitch, start, length]) => ({ pitch: pitch!, start: start!, length: length!, velocity: 0.75 })) },
  ],
};
const TEXT: Record<string, string> = { 'Songs/Kestrel launch film.json': writeSong(SONG), 'Songs/Night Drive.json': writeSong({ ...SONG, tempo: 92, tracks: SONG.tracks.slice(0, 2) }) };
const MODIFIED: Record<string, number> = { 'Songs/Kestrel launch film.json': now - 3_600_000, 'Songs/Night Drive.json': now - 86_400_000 };
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
