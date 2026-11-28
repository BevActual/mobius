import { describe, expect, it } from 'vitest';
import { parseSong, writeSong, type Song } from './song-format';
import { applyScene, insertSceneSettings, sceneSettingsWords, setSceneSetting } from './studio-scenes';

const song = (): Song => ({ version: 2, tempo: 120, key: 'C major', bars: 2, tracks: [] });

describe('scene tempo and time signature (Live 12, 7.2.1)', () => {
  it('sets and clears a scene’s tempo and signature, keeping none for a scene with neither', () => {
    const s = song();
    setSceneSetting(s, 2, { tempo: 140 });
    expect(s.sceneSettings).toEqual([null, null, { tempo: 140 }]);
    setSceneSetting(s, 2, { signature: [3, 4] });
    expect(sceneSettingsWords(s.sceneSettings![2]!)).toBe('140 BPM, 3/4');
    setSceneSetting(s, 0, { tempo: 999 });
    expect(s.sceneSettings![0]).toEqual({ tempo: 300 });
    setSceneSetting(s, 2, { tempo: null, signature: null });
    setSceneSetting(s, 0, { tempo: null });
    expect(s.sceneSettings).toBeUndefined();
  });

  it('gives the song a launched scene’s tempo and signature, and moves them with a scene put in above', () => {
    const s = song();
    setSceneSetting(s, 1, { tempo: 90, signature: [6, 8] });
    expect(applyScene(s, 0)).toBe(false);
    expect(applyScene(s, 1)).toBe(true);
    expect([s.tempo, s.signature]).toEqual([90, [6, 8]]);
    expect(applyScene(s, 1)).toBe(false);
    setSceneSetting(s, 0, { signature: [4, 4] });
    applyScene(s, 0);
    expect(s.signature).toBeUndefined();
    insertSceneSettings(s, 1);
    expect(s.sceneSettings).toEqual([{ signature: [4, 4] }, null, { tempo: 90, signature: [6, 8] }]);
  });

  it('reads and writes them, dropping what the song could not take', () => {
    const s = song();
    setSceneSetting(s, 1, { tempo: 96, signature: [7, 8] });
    const again = parseSong(writeSong(s));
    if (!('song' in again)) throw new Error('not read');
    expect(again.song.sceneSettings).toEqual([null, { tempo: 96, signature: [7, 8] }]);
    const odd = parseSong(JSON.stringify({ version: 2, tempo: 120, bars: 1, tracks: [], sceneSettings: [{ tempo: 'x', signature: [5, 3] }, { tempo: 12 }, 7] }));
    if (!('song' in odd)) throw new Error('not read');
    expect(odd.song.sceneSettings).toEqual([null, { tempo: 30 }]);
  });
});
