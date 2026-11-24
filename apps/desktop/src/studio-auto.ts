// A track's automation in the Arrange view: which settings have a line, the lane's 0-to-1 points for one, and the
// overrides a hand on a control makes (Ableton Live 12 manual, 25 "Automation and Editing Envelopes", 25.4 overriding).
import { EFFECT_NAMES, EFFECT_PARAMS, returnName, type AutoPoint, type Effect, type EffectKind, type ReturnTrack, type Track, type Unlinked } from './song-format';

/** A setting a track's lane can show: its engine name, its name in the window, its range and its own value now. */
export interface AutoChoice { name: string; label: string; lo: number; hi: number; own: number; kind?: EffectKind; setting?: string }

/** The built-in effects' settings the engine can move along the song (a reverb's size and damp, and the compressor's
 * threshold, ratio, attack and release, cannot be automated). */
export const AUTOMATABLE: { [K in EffectKind]: readonly string[] } = {
  eq: ['low', 'lowFreq', 'mid', 'midFreq', 'midQ', 'high', 'highFreq'],
  compressor: ['makeup'],
  delay: ['time', 'feedback', 'mix'],
  reverb: ['mix'],
  gate: [],
  limiter: ['gain'],
  saturator: ['drive', 'shape', 'output', 'mix'],
  autofilter: ['cutoff', 'resonance', 'rate', 'depth'],
  chorus: ['rate', 'depth', 'mix'],
  phaser: ['rate', 'depth', 'mix'],
  beatrepeat: ['chance', 'decay', 'volume'],
};
/** A setting's name where an effect's knob calls it something else (Live's Dry/Wet). */
const KIND_SETTING_NAMES: Partial<Record<EffectKind, Record<string, string>>> = { saturator: { mix: 'Dry/Wet' }, chorus: { mix: 'Dry/Wet' }, phaser: { mix: 'Dry/Wet' } };
const SETTING_NAMES: Record<string, string> = { low: 'Low', lowFreq: 'Low freq', mid: 'Mid', midFreq: 'Mid freq', midQ: 'Mid Q', high: 'High', highFreq: 'High freq', makeup: 'Makeup', time: 'Time', feedback: 'Feedback', mix: 'Mix', gain: 'Gain', drive: 'Drive', shape: 'Shape', output: 'Output', cutoff: 'Frequency', resonance: 'Resonance', rate: 'Rate', depth: 'Amount', chance: 'Chance', decay: 'Decay', volume: 'Volume' };

/** The settings a track's lane can show: Volume, Pan, a send per return track, then each built-in effect's settings. */
export function autoChoices(track: Track, returns: readonly ReturnTrack[] = []): AutoChoice[] {
  const out: AutoChoice[] = [
    { name: 'volume', label: 'Volume', lo: 0, hi: 1, own: track.volume },
    { name: 'pan', label: 'Pan', lo: -1, hi: 1, own: track.pan },
    ...returns.map((r, i) => ({ name: `send:${r.id}`, label: `Send ${returnName(r, i)}`, lo: 0, hi: 1, own: track.sends?.[r.id] ?? 0 })),
  ];
  // Each built-in effect's settings, numbered when there are two of a kind; a stack's macros, then its chains' effects.
  const builtins = (list: readonly Effect[], prefix: string) => {
    const counts = new Map<string, number>();
    for (const e of list) {
      if (e.kind === 'device' || e.kind === 'stack') continue;
      const n = (counts.get(e.kind) ?? 0) + 1;
      counts.set(e.kind, n);
      const twice = list.filter((f) => f.kind === e.kind).length > 1;
      const values = e as unknown as Record<string, number>;
      for (const k of AUTOMATABLE[e.kind]) {
        const r = EFFECT_PARAMS[e.kind][k]!;
        out.push({ name: `fx:${e.id}:${k}`, label: `${prefix}${EFFECT_NAMES[e.kind]}${twice ? ` ${n}` : ''} ${KIND_SETTING_NAMES[e.kind]?.[k] ?? SETTING_NAMES[k] ?? k}`, lo: r.lo, hi: r.hi, own: values[k] ?? r.start, kind: e.kind, setting: k });
      }
    }
  };
  builtins(track.fx ?? [], '');
  const stacks = (track.fx ?? []).filter((e) => e.kind === 'stack');
  stacks.forEach((s, si) => {
    const stack = stacks.length > 1 ? `Stack ${si + 1}` : 'Stack';
    s.macros.forEach((m, i) => out.push({ name: `fx:${s.id}:macro${i + 1}`, label: `${stack} ${m.name ?? `Macro ${i + 1}`}`, lo: 0, hi: 1, own: m.value }));
    s.chains.forEach((c, ci) => builtins(c.fx, `${stack} ${c.name ?? `Chain ${ci + 1}`} `));
  });
  return out;
}

/** A setting's points as the lane draws them, 0 to 1 across its range. */
export function toLane(points: readonly AutoPoint[], { lo, hi }: { lo: number; hi: number }): AutoPoint[] {
  return points.map((p) => ({ ...p, value: Math.max(0, Math.min(1, (p.value - lo) / (hi - lo))) }));
}

/** The lane's edited points back in the setting's range, each keeping the bend of the point it was at that beat. */
export function fromLane(next: readonly { beat: number; value: number }[], was: readonly AutoPoint[], { lo, hi }: { lo: number; hi: number }): AutoPoint[] {
  return next.map((p) => {
    const point: AutoPoint = { beat: p.beat, value: Math.round((lo + p.value * (hi - lo)) * 1e6) / 1e6 };
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

/** The settings a clip's envelopes can move (Live 12, 27): volume and sends as a share of the track's, pan added to it,
 * an audio clip's transposition in semitones added to its own (27.2.2), and the track's effect settings themselves. */
export function envelopeChoices(returns: readonly ReturnTrack[] = [], track?: Track, audio = false): AutoChoice[] {
  return [
    { name: 'volume', label: 'Volume', lo: 0, hi: 1, own: 1 },
    { name: 'pan', label: 'Pan', lo: -1, hi: 1, own: 0 },
    ...(audio ? [{ name: 'transpose', label: 'Transposition', lo: -48, hi: 48, own: 0 }] : []),
    ...returns.map((r, i) => ({ name: `send:${r.id}`, label: `Send ${returnName(r, i)}`, lo: 0, hi: 1, own: 1 })),
    // The track's effect settings, in their own units: the setting itself while the clip plays.
    ...(track ? autoChoices(track, returns).filter((c) => c.name.startsWith('fx:')) : []),
  ];
}

/** Sets one of a clip's envelopes, dropping it (and the clip's envelopes) when empty. */
export function setEnvelope(clip: { envelopes?: Record<string, AutoPoint[]>; unlinked?: Unlinked }, name: string, points: AutoPoint[]): void {
  const env = { ...(clip.envelopes ?? {}) };
  if (points.length > 0) env[name] = points; else delete env[name];
  if (Object.keys(env).length > 0) clip.envelopes = env; else delete clip.envelopes;
}

/** Unlinks one of a clip's envelopes with its own loop (Live 12, 27.3), or links it back to the clip's with none. */
export function setUnlinked(clip: { unlinked?: Unlinked }, name: string, loop: { start: number; end: number } | null): void {
  const all = { ...(clip.unlinked ?? {}) };
  if (loop && loop.end > loop.start) all[name] = loop; else delete all[name];
  if (Object.keys(all).length > 0) clip.unlinked = all; else delete clip.unlinked;
}

/** The settings a stack's macros can move: each built-in effect's in its chains, by chain, with their ranges. */
export function stackTargets(stack: { chains: readonly { name?: string; fx: readonly Effect[] }[] }): { target: string; label: string; lo: number; hi: number }[] {
  return stack.chains.flatMap((c, ci) => c.fx.flatMap((e) => {
    if (e.kind === 'device' || e.kind === 'stack') return [];
    return AUTOMATABLE[e.kind].map((k) => ({ target: `fx:${e.id}:${k}`, label: `${c.name ?? `Chain ${ci + 1}`} ${EFFECT_NAMES[e.kind]} ${KIND_SETTING_NAMES[e.kind]?.[k] ?? SETTING_NAMES[k] ?? k}`, lo: EFFECT_PARAMS[e.kind][k]!.lo, hi: EFFECT_PARAMS[e.kind][k]!.hi }));
  }));
}
