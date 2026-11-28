// Scene tempo and time signature (Live 12 manual, 7.2.1 "Editing Scene Tempo and Time Signature Values"): a scene can
// carry its own, and the song takes them when the scene is launched.
import { MAX_SCENES, type SceneSettings, type Signature, type Song } from './song-format';

/** A scene's settings, or null when it has none. */
export const sceneSettingsOf = (song: Pick<Song, 'sceneSettings'>, slot: number): SceneSettings | null => song.sceneSettings?.[slot] ?? null;

/** Sets (or, with undefined, clears) a scene's tempo or time signature; a scene left with neither has none. */
export function setSceneSetting(song: Song, slot: number, change: { tempo?: number | null; signature?: Signature | null }): void {
  if (slot < 0 || slot >= MAX_SCENES) return;
  const sets = [...(song.sceneSettings ?? [])];
  while (sets.length <= slot) sets.push(null);
  const next: SceneSettings = { ...(sets[slot] ?? {}) };
  if (change.tempo === null) delete next.tempo; else if (change.tempo !== undefined) next.tempo = Math.round(Math.min(300, Math.max(30, change.tempo)));
  if (change.signature === null) delete next.signature; else if (change.signature !== undefined) next.signature = [change.signature[0], change.signature[1]];
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

/** How a scene's settings read: "140 BPM", "3/4", or both. */
export const sceneSettingsWords = (set: SceneSettings | null): string => (set ? [set.tempo !== undefined ? `${set.tempo} BPM` : '', set.signature ? `${set.signature[0]}/${set.signature[1]}` : ''].filter(Boolean).join(', ') : '');
