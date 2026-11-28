import { describe, expect, it } from 'vitest';
import { parseSong, writeSong, type Follow, type Song } from './song-format';
import { applyScene, insertSceneSettings, sceneFollowAsk, sceneFollowTarget, sceneSettingsWords, setSceneSetting } from './studio-scenes';

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

describe('scene follow actions (Live 12, 16.7)', () => {
  const four = (): Song => ({ version: 2, tempo: 120, key: 'C major', bars: 2, tracks: [], scenes: ['A', 'B', 'C', 'D'] });
  it('goes to the scene its action names, round the song’s scenes, and picks Any and Other by the roll', () => {
    const s = four();
    const f = (a: Follow['a'], extra: Partial<Follow> = {}): Follow => ({ a, b: 'none', chance: 1, time: 16, ...extra });
    expect(sceneFollowTarget(s, 3, f('next'), 0)).toBe(0);
    expect(sceneFollowTarget(s, 0, f('previous'), 0)).toBe(3);
    expect([sceneFollowTarget(s, 2, f('first'), 0), sceneFollowTarget(s, 0, f('last'), 0), sceneFollowTarget(s, 1, f('again'), 0)]).toEqual([0, 3, 1]);
    expect(sceneFollowTarget(s, 1, f('stop'), 0)).toBe('stop');
    expect(sceneFollowTarget(s, 1, f('jump', { jump: 2 }), 0)).toBe(2);
    expect(sceneFollowTarget(s, 1, f('jump', { jump: 9 }), 0)).toBeNull();
    expect([0, 0.3, 0.6, 0.9].map((p) => sceneFollowTarget(s, 1, f('any'), 0, p))).toEqual([0, 1, 2, 3]);
    expect([0, 0.4, 0.9].map((p) => sceneFollowTarget(s, 1, f('other'), 0, p))).toEqual([2, 3, 0]);
    // B gets the rest of the chance.
    expect(sceneFollowTarget(s, 1, f('next', { chance: 0.25, b: 'first' }), 0.5)).toBe(0);
  });

  it('is asked for the bar before it is due, and kept in the song file with a time of its own', () => {
    expect(sceneFollowAsk(8, 16, 4)).toBeCloseTo(20, 2);
    expect(sceneFollowAsk(8, 2, 4)).toBeCloseTo(8, 2);
    const s = four();
    setSceneSetting(s, 1, { follow: { a: 'next', b: 'none', chance: 1, time: 8 } });
    expect(sceneSettingsWords(s.sceneSettings![1]!)).toBe('then next scene');
    const again = parseSong(writeSong(s));
    if (!('song' in again)) throw new Error('not read');
    expect(again.song.sceneSettings).toEqual([null, { follow: { a: 'next', b: 'none', chance: 1, time: 8 } }]);
    const odd = parseSong(JSON.stringify({ version: 2, tempo: 120, bars: 1, tracks: [], sceneSettings: [{ follow: { a: 'last', times: 4 } }, { follow: { a: 'none' } }] }));
    if (!('song' in odd)) throw new Error('not read');
    expect(odd.song.sceneSettings).toEqual([{ follow: { a: 'last', b: 'none', chance: 1, time: 16 } }]);
  });
});
