import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioClipDetail, changeAudio, keepsPitch, pitchParts, withPitch } from './studio-audio-clip';
import { envelopeChoices } from './studio-auto';
import type { ArrangeClip, ClipAudio, Track } from './song-format';

const track: Track = { id: 'v', name: 'Vox', kind: 'audio', instrument: 'piano', volume: 0.8, pan: 0, muted: false, solo: false, color: 'teal', clips: [] };
/** The Pitch knob, switched off. */
const PITCH_OFF = /data-disabled="true"><span class="ui-knob-name"[^>]*>Pitch</;
const show = (audio: ClipAudio) => renderToStaticMarkup(
  <AudioClipDetail clip={{ id: 'a1', start: 0, length: 4, name: 'Take', notes: [], audio } as ArrangeClip & { audio: ClipAudio }} track={track} returns={[]} tempo={120} songPath="" onClip={() => {}} />,
);

describe('an audio clip’s Pitch (Live 12, 8.4.7)', () => {
  it('splits a transpose into semitones and cents from -50 to 50, and back', () => {
    expect(pitchParts(3.25)).toEqual({ semitones: 3, cents: 25 });
    expect(pitchParts(-2.7)).toEqual({ semitones: -3, cents: 30 });
    expect(pitchParts()).toEqual({ semitones: 0, cents: 0 });
    expect(withPitch(-3, 30)).toBe(-2.7);
    expect(withPitch(48, 50)).toBe(48);
    expect(withPitch(-48, -50)).toBe(-48);
  });
  it('is heard only warped in a mode that keeps pitch, not in Re-Pitch (9.3.4)', () => {
    expect(keepsPitch({ file: 'a.wav' })).toBe(false);
    expect(keepsPitch({ file: 'a.wav', warp: true })).toBe(false);
    expect(keepsPitch({ file: 'a.wav', warp: true, mode: 'repitch' })).toBe(false);
    expect(keepsPitch({ file: 'a.wav', warp: true, mode: 'beats' })).toBe(true);
    expect(keepsPitch({ file: 'a.wav', mode: 'complex' })).toBe(false);
  });
  it('leaves the clip’s defaults out when a change brings one back', () => {
    expect(changeAudio({ file: 'a.wav', warp: true, transpose: 2, gainDb: -3 }, { transpose: 0, gainDb: 0, warp: false })).toEqual({ file: 'a.wav' });
  });
  it('shows the Sample settings, with Pitch off and saying why until it can be heard', () => {
    const off = show({ file: 'Samples/take.wav', warp: true, mode: 'repitch' });
    expect(off).toContain('Warp mode');
    expect(off).toContain('Re-Pitch changes pitch with speed');
    expect(off).toMatch(PITCH_OFF);
    const on = show({ file: 'Samples/take.wav', warp: true, mode: 'complex', transpose: 3.25 });
    expect(on).not.toContain('Re-Pitch changes pitch with speed');
    expect(on).toContain('+3 st');
    expect(on).not.toMatch(PITCH_OFF);
  });
});

describe('clip envelopes', () => {
  it('offer Transposition for an audio clip only (27.2.2)', () => {
    expect(envelopeChoices([], track, true).find((c) => c.name === 'transpose')).toMatchObject({ label: 'Transposition', lo: -48, hi: 48, own: 0 });
    expect(envelopeChoices([], track).some((c) => c.name === 'transpose')).toBe(false);
  });
});
