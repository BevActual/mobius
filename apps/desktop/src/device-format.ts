/**
 * A device: a small file of parts and cables that a track's sound goes through, and the knobs it shows on the track.
 * Music's four effects are built-in devices (`builtinDevice`); a song can also carry its own, as an effect of kind
 * `device` with the whole definition copied in. The plan is docs/reference/workbench-plan.md.
 *
 * - **parts**: Web Audio building blocks of fixed kinds (`PART_KINDS`), each with its own settings and ranges.
 * - **cables**: `[from, to]`. `from` is a part (its sound out). `to` is a part (its sound in), one of its inputs
 *   (`mix.wet`), or one of its settings (`tone.cutoff`), which is how an LFO moves a filter.
 * - **controls**: the knobs the device shows on the track, each a part's setting with a name.
 */

/** One setting of a part: a number in a range, or one of a few words. */
export type PartSetting = { lo: number; hi: number; start: number; unit?: string } | { choices: readonly string[]; start: string };

/** What a part of a kind has: its settings, its inputs (none for a source), and which settings a cable can move. */
export interface PartKind {
  /** What it does, for the agent guide and the parts list. */
  about: string;
  settings: Record<string, PartSetting>;
  /** Its inputs: `['in']` for one, named ones (`dry`, `wet`) for more, none for a part that makes its own signal. */
  inputs: readonly string[];
  /** Whether it sends sound (or movement) on; only `output` doesn't. */
  sends: boolean;
  /** The settings a cable can move, as they are heard (a filter's cutoff in Hz, a delay's time in seconds). */
  moves: readonly string[];
}

export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch'] as const;
export const LFO_SHAPES = ['sine', 'triangle', 'square', 'sawtooth'] as const;

export const PART_KINDS = {
  input: { about: 'The track’s sound coming in.', settings: {}, inputs: [], sends: true, moves: [] },
  output: { about: 'Where the device’s sound goes on to the track.', settings: {}, inputs: ['in'], sends: false, moves: [] },
  gain: { about: 'Louder or quieter: 1 leaves it as it is.', settings: { gain: { lo: 0, hi: 16, start: 1 } }, inputs: ['in'], sends: true, moves: ['gain'] },
  filter: {
    about: 'Shapes the tone: lowpass keeps the lows, highpass the highs; shelves and peaking lift or cut by gain dB.',
    settings: { type: { choices: FILTER_TYPES, start: 'lowpass' }, cutoff: { lo: 20, hi: 20000, start: 1000, unit: 'Hz' }, resonance: { lo: 0.1, hi: 20, start: 0.7 }, gain: { lo: -24, hi: 24, start: 0, unit: 'dB' } },
    inputs: ['in'], sends: true, moves: ['cutoff', 'resonance', 'gain'],
  },
  delay: { about: 'Holds the sound back by time beats. A loop of cables must pass through one.', settings: { time: { lo: 0.01, hi: 4, start: 0.75, unit: 'beats' } }, inputs: ['in'], sends: true, moves: ['time'] },
  lfo: { about: 'A slow wave that moves a setting it is cabled to, by depth in that setting’s units, rate times a second.', settings: { rate: { lo: 0.01, hi: 40, start: 1, unit: 'Hz' }, depth: { lo: 0, hi: 20000, start: 0 }, shape: { choices: LFO_SHAPES, start: 'sine' } }, inputs: [], sends: true, moves: [] },
  drive: { about: 'Grit: soft clipping, more as amount goes up.', settings: { amount: { lo: 0, hi: 1, start: 0.3 } }, inputs: ['in'], sends: true, moves: [] },
  compressor: {
    about: 'Turns loud parts down: above threshold dB by ratio to 1, reacting in attack, letting go in release seconds.',
    settings: { threshold: { lo: -60, hi: 0, start: -18, unit: 'dB' }, ratio: { lo: 1, hi: 20, start: 4 }, attack: { lo: 0.001, hi: 0.5, start: 0.01, unit: 's' }, release: { lo: 0.02, hi: 1, start: 0.2, unit: 's' }, knee: { lo: 0, hi: 40, start: 6, unit: 'dB' } },
    inputs: ['in'], sends: true, moves: [],
  },
  reverb: { about: 'A room that rings for size seconds, its highs softened by damp.', settings: { size: { lo: 0.3, hi: 8, start: 2, unit: 's' }, damp: { lo: 0, hi: 1, start: 0.4 } }, inputs: ['in'], sends: true, moves: [] },
  pan: { about: 'Left (-1) to right (1).', settings: { pan: { lo: -1, hi: 1, start: 0 } }, inputs: ['in'], sends: true, moves: ['pan'] },
  mix: { about: 'Blends dry and wet: all dry at 0, all wet at 1.', settings: { amount: { lo: 0, hi: 1, start: 0.25 } }, inputs: ['dry', 'wet'], sends: true, moves: [] },
} satisfies Record<string, PartKind>;

export type PartKindName = keyof typeof PART_KINDS;
export const PART_KIND_NAMES = Object.keys(PART_KINDS) as PartKindName[];

/** A part: its id, its kind and its settings (every one, after reading). */
export interface DevicePart { id: string; kind: PartKindName; [setting: string]: string | number }
export interface DeviceControl { label: string; part: string; param: string; min?: number; max?: number }
export interface Device { name: string; about?: string; parts: DevicePart[]; cables: [string, string][]; controls: DeviceControl[] }

export const MAX_PARTS = 24;
export const MAX_CABLES = 48;
export const MAX_CONTROLS = 12;

/** Where a cable ends: a part's sound in (`port` is its input's name), or one of its settings. */
export type CableEnd = { part: string; port: string } | { part: string; param: string };

/** Where a cable's `to` goes on its part, or why it can't. */
export function cableEnd(to: string, parts: ReadonlyMap<string, DevicePart>): CableEnd | string {
  const [id, rest, more] = to.split('.');
  const part = id ? parts.get(id) : undefined;
  if (!part || more !== undefined) return `a cable goes to “${to}”, which is not a part`;
  const kind = PART_KINDS[part.kind];
  if (rest === undefined) {
    if (kind.inputs.length === 1) return { part: part.id, port: kind.inputs[0]! };
    return kind.inputs.length === 0 ? `a cable goes into “${id}”, a ${part.kind}, which takes no sound in` : `a cable goes into “${id}”: say which input, ${kind.inputs.map((p) => `${id}.${p}`).join(' or ')}`;
  }
  if ((kind.inputs as readonly string[]).includes(rest) && kind.inputs.length > 1) return { part: part.id, port: rest };
  if ((kind.moves as readonly string[]).includes(rest)) return { part: part.id, param: rest };
  return `a cable goes to “${to}”, but a ${part.kind}’s ${rest} can’t be moved by a cable`;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clamp = (v: unknown, r: { lo: number; hi: number; start: number }) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(r.hi, Math.max(r.lo, v)) : r.start);

/**
 * A device from a file, or the first rule it breaks, said in a line. Settings out of range are brought in, and missing
 * ones get their start; anything that would make it not play (an unknown part, a cable to nowhere, a loop with no
 * delay in it) is refused.
 */
export function parseDevice(raw: unknown): { device: Device } | { error: string } {
  const o = obj(raw);
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Device';
  const list = Array.isArray(o.parts) ? o.parts : [];
  if (list.length > MAX_PARTS) return { error: `${name} has ${list.length} parts; at most ${MAX_PARTS}` };
  const parts: DevicePart[] = [];
  const byId = new Map<string, DevicePart>();
  for (const p of list) {
    const po = obj(p);
    const id = typeof po.id === 'string' ? po.id.trim() : '';
    if (!/^[A-Za-z][\w-]{0,23}$/.test(id)) return { error: `${name} has a part without an id of letters and numbers` };
    if (byId.has(id)) return { error: `${name} has two parts called “${id}”` };
    const kind = PART_KIND_NAMES.includes(po.kind as PartKindName) ? (po.kind as PartKindName) : null;
    if (!kind) return { error: `${name}’s part “${id}” is a “${String(po.kind)}”, which is not a kind of part (${PART_KIND_NAMES.join(', ')})` };
    const part: DevicePart = { id, kind };
    for (const [k, s] of Object.entries(PART_KINDS[kind].settings) as [string, PartSetting][]) {
      part[k] = 'choices' in s ? (s.choices.includes(po[k] as string) ? (po[k] as string) : s.start) : clamp(po[k], s);
    }
    parts.push(part);
    byId.set(id, part);
  }
  const ins = parts.filter((p) => p.kind === 'input'), outs = parts.filter((p) => p.kind === 'output');
  if (ins.length !== 1 || outs.length !== 1) return { error: `${name} needs one input part and one output part` };
  const cl = Array.isArray(o.cables) ? o.cables : [];
  if (cl.length > MAX_CABLES) return { error: `${name} has ${cl.length} cables; at most ${MAX_CABLES}` };
  const cables: [string, string][] = [];
  for (const c of cl) {
    if (!Array.isArray(c) || c.length !== 2 || typeof c[0] !== 'string' || typeof c[1] !== 'string') return { error: `${name} has a cable that is not ["from", "to"]` };
    const [from, to] = c as [string, string];
    const src = byId.get(from);
    if (!src) return { error: `${name} has a cable from “${from}”, which is not a part` };
    if (!PART_KINDS[src.kind].sends) return { error: `${name} has a cable from “${from}”, the output, which sends nothing on` };
    const end = cableEnd(to, byId);
    if (typeof end === 'string') return { error: `${name}: ${end}` };
    if (src.kind === 'lfo' && !('param' in end)) return { error: `${name}: the LFO “${from}” goes to a setting, such as ${to.split('.')[0]}.cutoff, not into a part’s sound` };
    if (cables.some(([f, t]) => f === from && t === to)) continue;
    cables.push([from, to]);
  }
  const loop = loopWithoutDelay(parts, cables);
  if (loop) return { error: `${name} has a loop with no delay in it (${loop.join(' → ')}); a loop must pass through a delay` };
  const ctl = Array.isArray(o.controls) ? o.controls.slice(0, MAX_CONTROLS) : [];
  const controls: DeviceControl[] = [];
  for (const c of ctl) {
    const co = obj(c);
    const part = typeof co.part === 'string' ? byId.get(co.part) : undefined;
    const param = typeof co.param === 'string' ? co.param : '';
    const s = part ? (PART_KINDS[part.kind].settings as Record<string, PartSetting>)[param] : undefined;
    if (!part || !s || 'choices' in s) return { error: `${name} has a control on “${String(co.part)}.${param}”, which is not a number setting of a part` };
    const control: DeviceControl = { label: typeof co.label === 'string' && co.label.trim() ? co.label.trim().slice(0, 16) : param, part: part.id, param };
    const min = typeof co.min === 'number' ? clamp(co.min, s) : s.lo, max = typeof co.max === 'number' ? clamp(co.max, s) : s.hi;
    if (min > s.lo) control.min = min;
    if (max < s.hi && max > min) control.max = max;
    controls.push(control);
  }
  const device: Device = { name, parts, cables, controls };
  if (typeof o.about === 'string' && o.about.trim()) device.about = o.about.trim().slice(0, 200);
  return { device };
}

/** The parts of a loop of cables that has no delay in it, or null when every loop passes through a delay. */
function loopWithoutDelay(parts: readonly DevicePart[], cables: readonly [string, string][]): string[] | null {
  const kinds = new Map(parts.map((p) => [p.id, p.kind]));
  // A delay breaks every loop through it, so leave its way out of the graph and look for any loop that is left.
  const next = new Map<string, string[]>();
  for (const [from, to] of cables) {
    if (kinds.get(from) === 'delay') continue;
    const target = to.split('.')[0]!;
    next.set(from, [...(next.get(from) ?? []), target]);
  }
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'open') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'open');
    path.push(id);
    for (const n of next.get(id) ?? []) {
      const found = visit(n);
      if (found) return found;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };
  for (const p of parts) {
    const found = visit(p.id);
    if (found) return found;
  }
  return null;
}

/** A control's range: its own, within its setting's. */
export function controlRange(device: Device, c: DeviceControl): { lo: number; hi: number; start: number; unit?: string } | null {
  const part = device.parts.find((p) => p.id === c.part);
  const s = part ? (PART_KINDS[part.kind].settings as Record<string, PartSetting>)[c.param] : undefined;
  if (!s || 'choices' in s) return null;
  return { ...s, lo: c.min ?? s.lo, hi: c.max ?? s.hi };
}

/** The value a control shows: its part's setting. */
export function controlValue(device: Device, c: DeviceControl): number {
  const v = device.parts.find((p) => p.id === c.part)?.[c.param];
  return typeof v === 'number' ? v : 0;
}
