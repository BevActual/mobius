import { cableEnd, PART_KINDS, type Device, type PartKindName, type PartSetting } from './device-format';
import type { PatchCable, PortSpec } from './ui';
import { deviceSettingText } from './studio-view';

/**
 * The Workbench's picture of a device: one box per part, one cable per cable, laid out as the patch canvas draws them.
 * Kept apart from the view so the mapping can be tested without a page.
 */

export const PART_NAMES: Record<PartKindName, string> = {
  input: 'Input', output: 'Output', gain: 'Gain', filter: 'Filter', delay: 'Delay', lfo: 'LFO', drive: 'Drive',
  compressor: 'Compressor', reverb: 'Reverb', pan: 'Pan', mix: 'Mix',
};

/** A setting on a part's box: its name, its value as heard, and whether a cable can move it (a port sits beside it). */
export interface BenchSetting { key: string; name: string; text: string; moves: boolean }
export interface BenchBox {
  id: string;
  title: string;
  kind: PartKindName;
  /** The kind's name, shown under the title when the part's own name doesn't already say it. */
  kindName: string | null;
  inputs: PortSpec[];
  outputs: PortSpec[];
  settings: BenchSetting[];
}
export interface BenchPatch {
  boxes: BenchBox[];
  cables: PatchCable[];
  /** Each cable's source part, whose level the cable shows. */
  source: Record<string, string>;
}

const words = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A device as boxes and cables. Cables the device couldn't play (refused when it was read) are left out. */
export function benchPatch(device: Device): BenchPatch {
  const parts = new Map(device.parts.map((p) => [p.id, p]));
  const boxes = device.parts.map((part): BenchBox => {
    const kind = PART_KINDS[part.kind];
    const name = PART_NAMES[part.kind];
    const own = part.kind === 'input' || part.kind === 'output';
    const moves = kind.moves as readonly string[];
    // A shelf has no resonance (it isn't heard), so it isn't shown.
    const shelf = part.type === 'lowshelf' || part.type === 'highshelf';
    const settings = (Object.entries(kind.settings) as [string, PartSetting][]).filter(([key]) => !(shelf && key === 'resonance')).map(([key, s]): BenchSetting => {
      const v = part[key];
      const n = typeof v === 'number' ? v : 'choices' in s ? 0 : s.start;
      // A small amount that rounds to 0 (an LFO's depth on a delay's time, in seconds) still shows what it is.
      const text = 'choices' in s ? String(v ?? s.start) : n !== 0 && deviceSettingText(s, n) === '0' ? String(Number(n.toPrecision(2))) : deviceSettingText(s, n);
      return { key, name: words(key), text, moves: moves.includes(key) };
    });
    return {
      id: part.id,
      title: own ? name : part.id,
      kind: part.kind,
      kindName: own || part.id.toLowerCase() === name.toLowerCase() ? null : name,
      inputs: kind.inputs.map((id) => ({ id, label: words(id), kind: 'audio' as const })),
      outputs: !kind.sends ? [] : [{ id: 'out', label: part.kind === 'lfo' ? 'Wave' : 'Out', kind: part.kind === 'lfo' ? 'control' as const : 'audio' as const }],
      settings,
    };
  });
  const cables: PatchCable[] = [];
  const source: Record<string, string> = {};
  device.cables.forEach(([from, to], i) => {
    const end = cableEnd(to, parts);
    if (typeof end === 'string' || !parts.has(from)) return;
    const id = `c${i}`;
    cables.push({ id, from: { box: from, port: 'out' }, to: 'param' in end ? { box: end.part, param: end.param } : { box: end.part, port: end.port } });
    source[id] = from;
  });
  return { boxes, cables, source };
}

/**
 * The cables that set where boxes go: all but those that run back to a part the sound already passed (an echo's
 * repeats), walking from the parts nothing feeds, so a feedback loop doesn't push the rest of the patch rightward.
 */
export function forwardCables(patch: Pick<BenchPatch, 'boxes' | 'cables'>): PatchCable[] {
  const next = new Map<string, string[]>();
  for (const c of patch.cables) next.set(c.from.box, [...(next.get(c.from.box) ?? []), c.to.box]);
  const back = new Set<string>();
  const state = new Map<string, 'walking' | 'done'>();
  const walk = (id: string) => {
    state.set(id, 'walking');
    for (const to of next.get(id) ?? []) {
      if (state.get(to) === 'walking') back.add(`${id}>${to}`);
      else if (!state.has(to)) walk(to);
    }
    state.set(id, 'done');
  };
  const fed = new Set(patch.cables.map((c) => c.to.box));
  for (const b of patch.boxes) if (!fed.has(b.id) && !state.has(b.id)) walk(b.id);
  for (const b of patch.boxes) if (!state.has(b.id)) walk(b.id);
  return patch.cables.filter((c) => !back.has(`${c.from.box}>${c.to.box}`));
}

/** About how tall a box is drawn, so the first layout leaves room between boxes in a column. */
export const benchBoxHeight = (b: Pick<BenchBox, 'inputs' | 'outputs' | 'settings' | 'kindName'>): number =>
  36 + Math.max(b.inputs.length * 36, b.outputs.length * 36, (b.kindName ? 20 : 0) + b.settings.length * 22, 44) + 8;
