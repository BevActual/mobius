// Scene tempo and time signature (Live 12 manual, 7.2.1 "Editing Scene Tempo and Time Signature Values"): a scene can
// carry its own, and the song takes them when the scene is launched.
import { MAX_SCENES, sceneCount, type Follow, type FollowAction, type SceneSettings, type Signature, type Song } from './song-format';

/** A scene's settings, or null when it has none. */
export const sceneSettingsOf = (song: Pick<Song, 'sceneSettings'>, slot: number): SceneSettings | null => song.sceneSettings?.[slot] ?? null;

/** Sets (or, with undefined, clears) a scene's tempo or time signature; a scene left with neither has none. */
export function setSceneSetting(song: Song, slot: number, change: { tempo?: number | null; signature?: Signature | null; follow?: Follow | null }): void {
  if (slot < 0 || slot >= MAX_SCENES) return;
  const sets = [...(song.sceneSettings ?? [])];
  while (sets.length <= slot) sets.push(null);
  const next: SceneSettings = { ...(sets[slot] ?? {}) };
  if (change.tempo === null) delete next.tempo; else if (change.tempo !== undefined) next.tempo = Math.round(Math.min(300, Math.max(30, change.tempo)));
  if (change.signature === null) delete next.signature; else if (change.signature !== undefined) next.signature = [change.signature[0], change.signature[1]];
  if (change.follow === null) delete next.follow; else if (change.follow !== undefined) next.follow = { ...change.follow };
  sets[slot] = Object.keys(next).length > 0 ? next : null;
  while (sets.length > 0 && sets[sets.length - 1] === null) sets.pop();
  if (sets.length > 0) song.sceneSettings = sets; else delete song.sceneSettings;
}

/** A launched scene's tempo and time signature, taken by the song ("The project will automatically adjust to these
 *  parameters when the scene is launched"). Whether anything changed. */
export function applyScene(song: Song, slot: number): boolean {
  const set = sceneSettingsOf(song, slot);
  if (!set) return false;
  let changed = false;
  if (set.tempo !== undefined && set.tempo !== song.tempo) { song.tempo = set.tempo; changed = true; }
  if (set.signature) {
    const [n, d] = set.signature;
    const was = song.signature ?? [4, 4];
    if (was[0] !== n || was[1] !== d) { if (n === 4 && d === 4) delete song.signature; else song.signature = [n, d]; changed = true; }
  }
  return changed;
}

/** A new scene put in at `row`: its settings move down with the scenes below it. */
export function insertSceneSettings(song: Song, row: number): void {
  if (!song.sceneSettings || row >= song.sceneSettings.length) return;
  const sets = [...song.sceneSettings];
  sets.splice(row, 0, null);
  song.sceneSettings = sets.slice(0, MAX_SCENES);
}

/** How a scene's settings read: "140 BPM", "3/4", "then next scene", or several. */
export const sceneSettingsWords = (set: SceneSettings | null): string => (set ? [set.tempo !== undefined ? `${set.tempo} BPM` : '', set.signature ? `${set.signature[0]}/${set.signature[1]}` : '', set.follow ? `then ${set.follow.a === 'jump' ? `scene ${(set.follow.jump ?? 0) + 1}` : (SCENE_FOLLOW_NAMES[set.follow.a] ?? '').toLowerCase()}` : ''].filter(Boolean).join(', ') : '');

/** The scene follow actions a scene's chooser offers (Jump is chosen by naming the scene). */
export const SCENE_FOLLOW_NAMES: Partial<Record<FollowAction, string>> = { none: 'No Action', next: 'Next Scene', previous: 'Previous Scene', first: 'First Scene', last: 'Last Scene', any: 'Any Scene', other: 'Another Scene', again: 'Play Again', stop: 'Stop All' };

/**
 * Where a scene's follow action goes once it fires (16.7, with the song's scenes as the group): a scene to launch,
 * 'stop' to stop every clip, or null for nothing. `roll` is 0 to 1: under the chance, A; else B. Any and Other pick a
 * scene from a second part of the roll.
 */
export function sceneFollowTarget(song: Song, slot: number, follow: Follow, roll: number, pick = roll): number | 'stop' | null {
  const action = roll < follow.chance ? follow.a : follow.b;
  const n = sceneCount(song);
  const k = Math.min(n - 1, Math.floor(Math.max(0, Math.min(0.999999, pick)) * n));
  switch (action) {
    case 'none': return null;
    case 'stop': return 'stop';
    case 'again': return slot;
    case 'next': return (slot + 1) % n;
    case 'previous': return (slot - 1 + n) % n;
    case 'first': return 0;
    case 'last': return n - 1;
    case 'any': return k;
    case 'other': return n <= 1 ? slot : (slot + 1 + Math.min(n - 2, Math.floor(Math.max(0, Math.min(0.999999, pick)) * (n - 1)))) % n;
    case 'jump': return follow.jump !== undefined && follow.jump < n ? follow.jump : null;
  }
}

/**
 * When, in beats since Play, to ask for a scene's follow action so it lands where it is due: the bar before, since a
 * launch waits for the next bar line. A scene that started at `start` with its action `time` beats on, in bars of `bar`.
 */
export const sceneFollowAsk = (start: number, time: number, bar: number): number => start + Math.max(0, time - bar) + 1e-3;
