import { BEATS_PER_BAR, MAX_SCENES, playedNotes, sceneCount, type ArrangeClip, type Clip, type Song, type SongNote } from './song-format';
import { recordOver } from './studio-view';

/**
 * Moving clips between the Session and Arrange views, as Live does (Live 12 manual, 7.5 "Recording Sessions into the
 * Arrangement"): a Session clip copied or dragged into Arrange lands on its track as a looped clip; an Arrange clip
 * copied to Session plays what it played there; and Consolidate Time to New Scene turns a stretch of the song into a
 * new scene, one clip per track. Each is a whole-song change, so it is one Undo.
 */

/** The data type a Session clip carries while dragged: `trackId` and `slot`, as JSON. */
export const CLIP_DRAG = 'application/x-mobius-session-clip';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function nextIds(clips: readonly ArrangeClip[]): () => string {
  const taken = new Set(clips.map((c) => c.id));
  let n = clips.length + 1;
  return () => { while (taken.has(`c${n}`)) n += 1; const id = `c${n}`; taken.add(id); return id; };
}

/**
 * The song with a Session clip placed in Arrange on track `trackId` from beat `at`: one pass of its loop, looping on
 * so stretching it repeats it, as Live's pasted clips do. What it covers there goes, as a recording would replace it,
 * and the song grows to hold it. Returns the new clip's id, or null when the track or clip is not there.
 */
export function placeInArrange(song: Song, trackId: string, clip: Clip, at: number): string | null {
  const t = song.tracks.find((x) => x.id === trackId);
  // An audio clip goes on an audio track and a clip of notes on any other, as Live keeps them.
  if (!t || t.frozen || !!clip.audio !== (t.kind === 'audio')) return null;
  const start = r4(Math.max(0, at));
  const length = Math.max(1, clip.bars) * BEATS_PER_BAR;
  const id = nextIds(t.clips);
  const kept = recordOver(t.clips, start, start + length, song.tempo, id);
  const placed: ArrangeClip = { id: id(), start, length, name: clip.name, loop: { start: 0, end: length }, notes: clip.notes.map((n) => ({ ...n })) };
  if (clip.audio) placed.audio = { ...clip.audio };
  if (clip.envelopes) placed.envelopes = structuredClone(clip.envelopes);
  if (clip.unlinked) placed.unlinked = structuredClone(clip.unlinked);
  t.clips = [...kept, placed].sort((a, b) => a.start - b.start);
  song.bars = Math.max(song.bars, Math.ceil((start + length) / BEATS_PER_BAR));
  return placed.id;
}

/**
 * A Session clip that plays what an Arrange clip played: its notes from the start marker, round its loop, for its
 * length, in whole bars. An audio clip keeps its sound and where in it it starts.
 */
export function asSessionClip(c: ArrangeClip, fallbackName: string): Clip {
  const notes: SongNote[] = c.audio ? [] : playedNotes(c).map((n) => ({ ...n, start: r4(n.start - c.start) }));
  const out: Clip = { name: (c.name || fallbackName).slice(0, 60), bars: Math.max(1, Math.ceil(c.length / BEATS_PER_BAR - 1e-9)), notes };
  if (c.audio) out.audio = { ...c.audio };
  if (c.envelopes && !c.loop && !c.offset) out.envelopes = structuredClone(c.envelopes);
  return out;
}

/** Puts a clip into a slot, growing the track's slots (and the song's scenes) to reach it. */
function putSlot(song: Song, trackId: string, slot: number, clip: Clip | null): void {
  const t = song.tracks.find((x) => x.id === trackId);
  if (!t) return;
  const slots = [...(t.slots ?? [])];
  while (slots.length <= slot) slots.push(null);
  slots[slot] = clip;
  while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
  if (slots.length > 0) t.slots = slots; else delete t.slots;
  if (slot >= sceneCount(song)) { const names = [...(song.scenes ?? [])]; while (names.length <= slot) names.push(''); song.scenes = names; }
}

/**
 * The slot an Arrange clip goes to in Session: the first empty one on its track from the top, or a new scene below
 * the last. Null when the track is at Live's limit of scenes.
 */
export function freeSlot(song: Song, trackId: string): number | null {
  const t = song.tracks.find((x) => x.id === trackId);
  if (!t) return null;
  for (let i = 0; i < MAX_SCENES; i += 1) if (!t.slots?.[i]) return i;
  return null;
}

/** The song with an Arrange clip copied into Session on its own track. Returns the slot it went to, or null. */
export function copyToSession(song: Song, trackId: string, clipId: string): number | null {
  const t = song.tracks.find((x) => x.id === trackId);
  const c = t?.clips.find((x) => x.id === clipId);
  if (!t || !c) return null;
  const slot = freeSlot(song, trackId);
  if (slot === null) return null;
  putSlot(song, trackId, slot, asSessionClip(c, t.name));
  return slot;
}

/**
 * The song with a Session clip moved (or copied, with `copy`) from one slot to another, on any track of the same
 * kind: what was in the slot it lands on goes. Returns false when nothing moved.
 */
export function moveSlot(song: Song, from: { trackId: string; slot: number }, to: { trackId: string; slot: number }, copy: boolean): boolean {
  const a = song.tracks.find((x) => x.id === from.trackId);
  const b = song.tracks.find((x) => x.id === to.trackId);
  const clip = a?.slots?.[from.slot];
  if (!a || !b || !clip || (from.trackId === to.trackId && from.slot === to.slot)) return false;
  if ((a.kind === 'audio') !== (b.kind === 'audio')) return false;
  if (!copy) putSlot(song, from.trackId, from.slot, null);
  putSlot(song, to.trackId, to.slot, structuredClone(clip));
  return true;
}

/**
 * Consolidate Time to New Scene (Live 12, 7.5): the stretch of the song from `from` to `to` (beats) becomes one new
 * clip per track, in a new scene below `after` (or at the bottom without one). A track with nothing playing there gets
 * an empty slot. Audio tracks are left empty: Live renders their sound to a new sample, which the window can't yet.
 * Returns the new scene's row, or null when the song is at its limit of scenes or the stretch is empty.
 */
export function consolidateToScene(song: Song, from: number, to: number, after: number | null): number | null {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.max(from, to);
  if (hi - lo < 1e-9) return null;
  const scenes = sceneCount(song);
  const filled = Math.max(song.scenes?.length ?? 0, ...song.tracks.map((t) => t.slots?.length ?? 0));
  const row = after === null ? Math.max(filled, 0) : Math.min(after + 1, scenes);
  if (filled >= MAX_SCENES || row >= MAX_SCENES) return null;
  const bars = Math.max(1, Math.ceil((hi - lo) / BEATS_PER_BAR - 1e-9));
  const names = [...(song.scenes ?? [])];
  while (names.length < row) names.push('');
  names.splice(row, 0, '');
  song.scenes = names;
  for (const t of song.tracks) {
    const notes = t.kind === 'audio' || t.frozen ? [] : t.clips.filter((c) => !c.muted).flatMap(playedNotes)
      // A note held into the stretch starts at its start, as Live cuts it; what runs past its end is cut too.
      .filter((n) => n.start < hi - 1e-9 && n.start + n.length > lo + 1e-9)
      .map((n) => { const at = Math.max(n.start, lo); return { ...n, start: r4(at - lo), length: r4(Math.min(n.start + n.length, hi) - at) }; })
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const named = t.clips.find((c) => c.start < hi && c.start + c.length > lo)?.name;
    const clip: Clip | null = notes.length ? { name: (named || t.name).slice(0, 60), bars, notes } : null;
    const slots = [...(t.slots ?? [])];
    while (slots.length < row) slots.push(null);
    slots.splice(row, 0, clip);
    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
    if (slots.length > 0) t.slots = slots; else delete t.slots;
  }
  return row;
}
