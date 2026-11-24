// An audio clip in the Detail panel's Clip tab (Ableton Live 12 manual, 8.4 "Audio Clip Properties"): its Warp switch
// and warp mode (8.4.1, 9.3), its Gain and Pitch (8.4.7 "Clip Gain and Pitch"), its waveform, and its clip envelopes
// (27), Transposition among them (27.2.2).
import { useEffect, useState } from 'react';
import { AutomationLane, Knob, NumberField, Select, Switch } from './ui';
import { envelopeChoices, fromLane, laneEmpty, setEnvelope, toLane } from './studio-auto';
import { panText } from './studio-view';
import { ClipWave } from './studio-wave';
import { ownLength, type ArrangeClip, type ClipAudio, type ReturnTrack, type Track } from './song-format';

/** The warp modes, in the manual's order (9.3.1 to 9.3.5); a clip with none plays as Re-Pitch. */
export const WARP_MODES = [
  { value: 'beats', label: 'Beats' }, { value: 'tones', label: 'Tones' }, { value: 'texture', label: 'Texture' },
  { value: 'repitch', label: 'Re-Pitch' }, { value: 'complex', label: 'Complex' }, { value: 'complexpro', label: 'Complex Pro' },
] as const;
export const MAX_TRANSPOSE = 48;

/** Whether a clip's Pitch is heard: only warped, in a mode that keeps pitch (Re-Pitch deactivates it, 9.3.4). */
export const keepsPitch = (a: ClipAudio): boolean => !!a.warp && !!a.mode && a.mode !== 'repitch';
/** A transpose (semitones, hundredths as cents) as Live's Pitch shows it: whole semitones, and cents from -50 to 50. */
export function pitchParts(transpose = 0): { semitones: number; cents: number } {
  const semitones = Math.round(transpose);
  return { semitones, cents: Math.round((transpose - semitones) * 100) };
}
/** Semitones and cents back as a transpose, kept to -48..48 and to whole cents. */
export function withPitch(semitones: number, cents: number): number {
  return Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, Math.round((semitones + cents / 100) * 100) / 100));
}
/** The clip's sound with one change, leaving its defaults out as the song format does. */
export function changeAudio(a: ClipAudio, change: Partial<ClipAudio>): ClipAudio {
  const next: ClipAudio = { ...a, ...change };
  if (!next.gainDb) delete next.gainDb;
  if (!next.transpose) delete next.transpose;
  if (!next.warp) delete next.warp;
  return next;
}

const db = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`;
const st = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} st`;

/** How wide an element is, kept as it resizes. */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const seen = new ResizeObserver(() => setWidth(el.clientWidth));
    seen.observe(el);
    return () => seen.disconnect();
  }, [el]);
  return [setEl, width];
}

export function AudioClipDetail({ clip, track, returns, tempo, songPath, onClip }: {
  clip: ArrangeClip & { audio: ClipAudio }; track: Track; returns: readonly ReturnTrack[]; tempo: number; songPath: string;
  /** Changes the clip; `tag` merges a run of changes to one setting into one undo step. */
  onClip: (fn: (c: ArrangeClip) => void, tag: string) => void;
}) {
  const a = clip.audio;
  const put = (change: Partial<ClipAudio>, what: string) => onClip((c) => { if (c.audio) c.audio = changeAudio(c.audio, change); }, `audio-${what}:${clip.id}`);
  const pitch = pitchParts(a.transpose);
  const heard = keepsPitch(a);
  const why = heard ? undefined : a.warp ? 'Re-Pitch changes pitch with speed: pick another warp mode to set the Pitch' : 'Warp the clip, in a mode that keeps pitch, to set its Pitch';
  const beats = ownLength(clip);
  const seconds = (beats * 60) / (a.warp && a.bpm ? a.bpm : tempo);
  // Its envelopes (27): the one chosen shows below the waveform, across the clip's own beats.
  const choices = envelopeChoices(returns, track, true);
  const [laneName, setLaneName] = useState('volume');
  const lane = choices.find((c) => c.name === laneName) ?? choices[0]!;
  const was = clip.envelopes?.[lane.name] ?? [];
  const [measure, measured] = useWidth();
  const width = measured || 1200;
  return (
    <div className="studio-audio-clip" role="group" aria-label={`Audio clip ${clip.name ?? track.name}`}>
      <div className="studio-audio-props" role="group" aria-label="Sample">
        <Switch label="Warp" checked={!!a.warp} onChange={(on) => put({ warp: on }, 'warp')} />
        <Select label="Warp mode" value={a.mode ?? 'repitch'} choices={WARP_MODES} disabled={!a.warp} onChange={(mode) => put({ mode }, 'mode')} />
        <Knob label="Gain" value={a.gainDb ?? 0} min={-70} max={24} step={0.1} origin={0} reset={0} format={db} onChange={(v) => put({ gainDb: v }, 'gain')} />
        <span className="studio-audio-pitch" role="group" aria-label="Pitch" title={why}>
          <Knob label="Pitch" value={pitch.semitones} min={-MAX_TRANSPOSE} max={MAX_TRANSPOSE} step={1} origin={0} reset={0} format={st} disabled={!heard}
            onChange={(v) => put({ transpose: withPitch(v, pitch.cents) }, 'pitch')} />
          <NumberField label="Cents" value={pitch.cents} min={-50} max={50} step={1} reset={0} signed unit="ct" width={3} disabled={!heard}
            onChange={(v) => put({ transpose: withPitch(pitch.semitones, v) }, 'pitch')} />
        </span>
        {why && <p className="studio-dev-note studio-audio-why">{why}.</p>}
      </div>
      <div className="studio-audio-wave" ref={measure}>
        <ClipWave songPath={songPath} file={a.file} offset={a.offset ?? 0} seconds={seconds} width={width} />
      </div>
      <div className="studio-audio-env" role="group" aria-label={`Envelopes of ${clip.name ?? track.name}`}>
        <Select inline label="Envelope" value={lane.name} choices={choices.map((c) => ({ value: c.name, label: `${c.label}${clip.envelopes?.[c.name]?.length ? ' •' : ''}` }))} onChange={setLaneName} />
        <AutomationLane className="studio-audio-lane" label={`${lane.label} envelope`} head={false} color={track.color} points={toLane(was, lane)} beats={beats} pxPerBeat={width / beats} empty={laneEmpty(lane)}
          format={lane.name === 'pan' ? (v) => panText(v * 2 - 1) : lane.name === 'transpose' ? (v) => st(Math.round((lane.lo + v * (lane.hi - lane.lo)) * 100) / 100) : undefined}
          onChange={(next) => onClip((c) => setEnvelope(c, lane.name, fromLane(next, was, lane)), `env:${clip.id}:${lane.name}`)} />
      </div>
    </div>
  );
}
