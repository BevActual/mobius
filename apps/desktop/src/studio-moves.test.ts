import { describe, expect, it } from 'vitest';
import { sceneCount, type ArrangeClip, type Song, type Track } from './song-format';
import { asSessionClip, consolidateToScene, copyToSession, moveSlot, placeInArrange } from './studio-moves';

const track = (id: string, over: Partial<Track> = {}): Track => ({ id, name: id.toUpperCase(), instrument: 'bass', volume: 0.8, pan: 0, muted: false, solo: false, color: 'blue', clips: [], ...over });
const song = (tracks: Track[], bars = 8): Song => ({ version: 2, tempo: 120, key: 'C major', bars, tracks });
const note = (start: number, pitch = 40, length = 1) => ({ pitch, start, length, velocity: 100 });

describe('placeInArrange', () => {
  it('lands a Session clip on its track as one looped pass, replacing what it covers, and grows the song', () => {
    const old: ArrangeClip = { id: 'c1', start: 0, length: 16, name: 'Old', notes: [note(0), note(12)] };
    const s = song([track('a', { clips: [old] })], 4);
    const id = placeInArrange(s, 'a', { name: 'Riff', bars: 2, notes: [note(0, 45), note(4, 47)] }, 12);
    const clips = s.tracks[0]!.clips;
    expect(clips.map((c) => [c.start, c.length, c.name ?? ''])).toEqual([[0, 12, 'Old'], [12, 8, 'Riff']]);
    expect(clips[1]).toMatchObject({ id, loop: { start: 0, end: 8 } });
    expect(clips[0]!.notes).toEqual([note(0)]);
    expect(s.bars).toBe(5);
  });
  it('refuses a frozen track or one not in the song', () => {
    const s = song([track('a', { frozen: { file: 'x.wav' } })]);
    expect(placeInArrange(s, 'a', { name: 'R', bars: 1, notes: [] }, 0)).toBeNull();
    expect(placeInArrange(s, 'b', { name: 'R', bars: 1, notes: [] }, 0)).toBeNull();
  });
});

describe('asSessionClip and copyToSession', () => {
  it('plays what the Arrange clip played: from its start marker, round its loop, in whole bars', () => {
    const c: ArrangeClip = { id: 'c1', start: 8, length: 6, offset: 1, loop: { start: 0, end: 2 }, notes: [note(0, 40), note(1, 42)] };
    const clip = asSessionClip(c, 'Bass');
    expect(clip.name).toBe('Bass');
    expect(clip.bars).toBe(2);
    expect(clip.notes.map((n) => [n.start, n.pitch])).toEqual([[0, 42], [1, 40], [2, 42], [3, 40], [4, 42], [5, 40]]);
  });
  it('goes to the first empty slot of its track, adding a scene below when they are all full', () => {
    const full = Array.from({ length: 4 }, (_, i) => ({ name: `S${i}`, bars: 1, notes: [] }));
    const s = song([track('a', { clips: [{ id: 'c1', start: 0, length: 4, name: 'Verse', notes: [note(0)] }], slots: [full[0]!, null, full[2]!] }), track('b', { slots: full })]);
    expect(copyToSession(s, 'a', 'c1')).toBe(1);
    expect(s.tracks[0]!.slots?.[1]?.name).toBe('Verse');
    s.tracks[0]!.clips[0]!.name = 'Chorus';
    s.tracks[0]!.slots = [...full];
    expect(copyToSession(s, 'a', 'c1')).toBe(4);
    expect(sceneCount(s)).toBe(5);
  });
});

describe('moveSlot', () => {
  it('moves a clip to another slot, or copies it, but never between audio and MIDI tracks', () => {
    const clip = { name: 'Hook', bars: 1, notes: [note(0)] };
    const s = song([track('a', { slots: [clip] }), track('b'), track('c', { kind: 'audio' })]);
    expect(moveSlot(s, { trackId: 'a', slot: 0 }, { trackId: 'b', slot: 2 }, false)).toBe(true);
    expect(s.tracks[0]!.slots).toBeUndefined();
    expect(s.tracks[1]!.slots?.[2]?.name).toBe('Hook');
    expect(moveSlot(s, { trackId: 'b', slot: 2 }, { trackId: 'b', slot: 0 }, true)).toBe(true);
    expect(s.tracks[1]!.slots?.map((x) => x?.name ?? null)).toEqual(['Hook', null, 'Hook']);
    expect(moveSlot(s, { trackId: 'b', slot: 0 }, { trackId: 'c', slot: 0 }, false)).toBe(false);
  });
});

describe('consolidateToScene', () => {
  it('turns a stretch of the song into a new scene below the chosen one, a clip per track that plays there', () => {
    const s = song([
      track('a', { clips: [{ id: 'c1', start: 0, length: 16, name: 'Line', loop: { start: 0, end: 4 }, notes: [note(0), note(3, 43, 2)] }], slots: [{ name: 'Top', bars: 1, notes: [] }, { name: 'Next', bars: 1, notes: [] }] }),
      track('b', { clips: [{ id: 'c1', start: 12, length: 4, notes: [note(0)] }] }),
      track('c', { kind: 'audio', clips: [{ id: 'c1', start: 0, length: 8, notes: [], audio: { file: 'a.wav' } }] }),
    ]);
    expect(consolidateToScene(s, 4, 8, 0)).toBe(1);
    const a = s.tracks[0]!.slots!;
    expect(a.map((x) => x?.name ?? null)).toEqual(['Top', 'Line', 'Next']);
    expect(a[1]).toMatchObject({ bars: 1, notes: [note(0), note(3, 43, 1)] });
    expect(s.tracks[1]!.slots).toBeUndefined();
    expect(s.tracks[2]!.slots).toBeUndefined();
    expect(s.scenes).toEqual(['', '']);
  });
  it('does nothing for an empty stretch', () => {
    expect(consolidateToScene(song([track('a')]), 4, 4, null)).toBeNull();
  });
});
