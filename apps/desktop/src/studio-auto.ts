// A track's automation in the Arrange view: which settings have a line, the lane's 0-to-1 points for one, and the
// overrides a hand on a control makes (Ableton Live 12 manual, 25 "Automation and Editing Envelopes", 25.4 overriding).
import { EFFECT_NAMES, EFFECT_PARAMS, returnName, type AutoPoint, type Effect, type EffectKind, type ReturnTrack, type Track } from './song-format';

/** A setting a track's lane can show: its engine name, its name in the window, its range and its own value now. */
export interface AutoChoice { name: string; label: string; lo: number; hi: number; own: number; kind?: EffectKind; setting?: string }

/** The built-in effects' settings the engine can move along the song (a reverb's size and damp, and the compressor's
 * threshold, ratio, attack and release, cannot be automated). */
export const AUTOMATABLE: { [K in EffectKind]: readonly string[] } = {
  eq: ['low', 'lowFreq', 'mid', 'midFreq', 'midQ', 'high', 'highFreq'],
  compressor: ['makeup'],
  delay: ['time', 'feedback', 'mix'],
  reverb: ['mix'],
};
const SETTING_NAMES: Record<string, string> = { low: 'Low', lowFreq: 'Low freq', mid: 'Mid', midFreq: 'Mid freq', midQ: 'Mid Q', high: 'High', highFreq: 'High freq', makeup: 'Makeup', time: 'Time', feedback: 'Feedback', mix: 'Mix' };

/** The settings a track's lane can show: Volume, Pan, a send per return track, then each built-in effect's settings. */
export function autoChoices(track: Track, returns: readonly ReturnTrack[] = []): AutoChoice[] {
  const out: AutoChoice[] = [
    { name: 'volume', label: 'Volume', lo: 0, hi: 1, own: track.volume },
    { name: 'pan', label: 'Pan', lo: -1, hi: 1, own: track.pan },
    ...returns.map((r, i) => ({ name: `send:${r.id}`, label: `Send ${returnName(r, i)}`, lo: 0, hi: 1, own: track.sends?.[r.id] ?? 0 })),
  ];
  const counts = new Map<string, number>();
  for (const e of track.fx ?? []) {
    if (e.kind === 'device') continue;
    const n = (counts.get(e.kind) ?? 0) + 1;
    counts.set(e.kind, n);
    const twice = (track.fx ?? []).filter((f) => f.kind === e.kind).length > 1;
    const values = e as unknown as Record<string, number>;
    for (const k of AUTOMATABLE[e.kind]) {
      const r = EFFECT_PARAMS[e.kind][k]!;
      out.push({ name: `fx:${e.id}:${k}`, label: `${EFFECT_NAMES[e.kind]}${twice ? ` ${n}` : ''} ${SETTING_NAMES[k] ?? k}`, lo: r.lo, hi: r.hi, own: values[k] ?? r.start, kind: e.kind, setting: k });
    }
  }
  return out;
}

/** A setting's points as the lane draws them, 0 to 1 across its range. */
export function toLane(points: readonly AutoPoint[], { lo, hi }: { lo: number; hi: number }): AutoPoint[] {
  return points.map((p) => ({ ...p, value: Math.max(0, Math.min(1, (p.value - lo) / (hi - lo))) }));
}

/** The lane's edited points back in the setting's range, each keeping the bend of the point it was at that beat. */
export function fromLane(next: readonly { beat: number; value: number }[], was: readonly AutoPoint[], { lo, hi }: { lo: number; hi: number }): AutoPoint[] {
  return next.map((p) => {
    const point: AutoPoint = { beat: p.beat, value: Math.round((lo + p.value * (hi - lo)) * 1000) / 1000 };
    const curve = was.find((w) => w.beat === p.beat)?.curve;
    if (curve !== undefined) point.curve = curve;
    return point;
  });
}

/** A setting's own value on the lane's 0 to 1, drawn faint where it has no line. */
export const laneEmpty = (c: AutoChoice): number => (c.own - c.lo) / (c.hi - c.lo);

/** A hand moved an effect: each automated setting it changed now plays the hand's value. */
export function overrideEffect(track: Track, before: Effect, after: Effect): void {
  const a = before as unknown as Record<string, unknown>, b = after as unknown as Record<string, unknown>;
  for (const k of Object.keys(b)) if (typeof b[k] === 'number' && a[k] !== b[k]) override(track, `fx:${after.id}:${k}`);
}

/** Sets a setting's line on the track, dropping it (and its override) when empty. */
export function setAuto(track: Track, name: string, points: AutoPoint[]): void {
  const auto = { ...(track.auto ?? {}) };
  if (points.length > 0) auto[name] = points; else delete auto[name];
  if (Object.keys(auto).length > 0) track.auto = auto; else delete track.auto;
  if (points.length === 0) reEnable(track, name);
}

/** A hand moved this setting: when it has a line it now plays the hand's value until automation is re-enabled. */
export function override(track: Track, name: string): void {
  if (!track.auto?.[name]?.length || track.autoOff?.includes(name)) return;
  track.autoOff = [...(track.autoOff ?? []), name];
}

/** Re-enables one setting's automation, or all of them with no name (Live 12, 25.4 "Re-Enable Automation"). */
export function reEnable(track: Track, name?: string): void {
  const left = name === undefined ? [] : (track.autoOff ?? []).filter((n) => n !== name);
  if (left.length > 0) track.autoOff = left; else delete track.autoOff;
}
