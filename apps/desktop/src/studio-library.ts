import { EFFECT_KINDS, EFFECT_NAMES, INSTRUMENT_NAMES, KIT_DEFAULTS, SOUND_DEFAULTS, type EffectKind, type Instrument, type SynthInstrument, type KitSound, type Sound } from './song-format';
import type { TagPicks } from './ui';

/**
 * Music's Library: what can be put on a track, modelled on Live 12's Browser (docs/reference/music-parity.md, "The
 * Library panel"). Kept apart from the screen so search, tags and collections can be tested.
 */
export type LibraryCategory = 'all' | 'sounds' | 'drums' | 'instruments' | 'effects';
export const CATEGORIES: { id: LibraryCategory; name: string }[] = [
  { id: 'all', name: 'All' }, { id: 'sounds', name: 'Sounds' }, { id: 'drums', name: 'Drums' },
  { id: 'instruments', name: 'Instruments' }, { id: 'effects', name: 'Audio Effects' },
];

export interface LibraryItem {
  id: string;
  name: string;
  category: Exclude<LibraryCategory, 'all'>;
  /** What it puts on a track: an instrument with a sound or a kit, or an effect. */
  instrument?: Instrument;
  sound?: Sound;
  kit?: KitSound;
  effect?: EffectKind;
  /** Tags by group id (see TAG_GROUPS). */
  tags: Record<string, string[]>;
}

/** The filter bar's groups, as Live's Sounds label shows them: what a sound is, and how it sounds. */
export const TAG_GROUPS = [
  { id: 'type', name: 'Type', tags: ['Bass', 'Keys', 'Pad', 'Lead', 'Pluck', 'Drums'] },
  { id: 'character', name: 'Character', tags: ['Warm', 'Bright', 'Dark', 'Soft', 'Hard', 'Wide'] },
] as const;

const sound = (base: SynthInstrument, over: Partial<Sound>): Sound => ({ ...SOUND_DEFAULTS[base], ...over });
const preset = (id: string, name: string, instrument: SynthInstrument, over: Partial<Sound>, type: string, character: string[]): LibraryItem =>
  ({ id: `sound:${id}`, name, category: 'sounds', instrument, sound: sound(instrument, over), tags: { type: [type], character } });
const kit = (id: string, name: string, k: Partial<KitSound>, character: string[]): LibraryItem =>
  ({ id: `drums:${id}`, name, category: 'drums', instrument: 'drums', kit: { ...KIT_DEFAULTS, ...k }, tags: { type: ['Drums'], character } });

export const LIBRARY: readonly LibraryItem[] = [
  preset('sub-bass', 'Sub Bass', 'bass', { shape: 0, sub: 0.8, cutoff: 400 }, 'Bass', ['Dark', 'Soft']),
  preset('saw-bass', 'Saw Bass', 'bass', { shape: 1, cutoff: 1400, resonance: 0.3, envAmount: 0.4, drive: 0.3 }, 'Bass', ['Bright', 'Hard']),
  preset('round-bass', 'Round Bass', 'bass', { shape: 0.4, sub: 0.4, cutoff: 600 }, 'Bass', ['Warm']),
  preset('electric-keys', 'Electric Keys', 'piano', { shape: 0.1, vibrato: 6, rate: 4.5, cutoff: 3500 }, 'Keys', ['Warm', 'Soft']),
  preset('glass-keys', 'Glass Keys', 'piano', { shape: 0.5, cutoff: 9000, decay: 1.4, sustain: 0.1 }, 'Keys', ['Bright']),
  preset('felt-keys', 'Felt Keys', 'piano', { shape: 0, cutoff: 1800, attack: 0.01 }, 'Keys', ['Dark', 'Soft']),
  preset('string-pad', 'String Pad', 'pad', { detune: 20, attack: 0.6, release: 1.2, cutoff: 2500 }, 'Pad', ['Warm', 'Wide']),
  preset('dark-pad', 'Dark Pad', 'pad', { detune: 10, cutoff: 700, attack: 0.9, release: 1.8 }, 'Pad', ['Dark', 'Soft', 'Wide']),
  preset('shimmer-pad', 'Shimmer Pad', 'pad', { detune: 30, cutoff: 8000, vibrato: 8, rate: 5.5 }, 'Pad', ['Bright', 'Wide']),
  preset('square-lead', 'Square Lead', 'lead', { shape: 0.5, cutoff: 4000, vibrato: 10, rate: 5 }, 'Lead', ['Bright']),
  preset('soft-lead', 'Soft Lead', 'lead', { shape: 0.2, cutoff: 2500, attack: 0.04 }, 'Lead', ['Soft', 'Warm']),
  preset('acid-lead', 'Acid Lead', 'lead', { shape: 1, cutoff: 900, resonance: 0.8, envAmount: 0.8, drive: 0.4 }, 'Lead', ['Hard', 'Bright']),
  preset('pluck', 'Pluck', 'lead', { shape: 0.8, cutoff: 1200, envAmount: 0.7, decay: 0.2, sustain: 0, release: 0.15 }, 'Pluck', ['Bright']),
  preset('mallet', 'Mallet', 'piano', { shape: 0, decay: 0.35, sustain: 0, cutoff: 4000 }, 'Pluck', ['Soft']),
  kit('classic', 'Classic Kit', {}, ['Warm']),
  kit('tight', 'Tight Kit', { decay: 0.6, tone: 0.7 }, ['Bright', 'Hard']),
  kit('deep', 'Deep Kit', { tune: -4, decay: 1.6, tone: 0.3 }, ['Dark']),
  ...(Object.keys(INSTRUMENT_NAMES) as Instrument[]).map((i): LibraryItem => ({ id: `instrument:${i}`, name: INSTRUMENT_NAMES[i], category: 'instruments', instrument: i, tags: { type: [i === 'piano' ? 'Keys' : INSTRUMENT_NAMES[i]] } })),
  ...EFFECT_KINDS.map((e): LibraryItem => ({ id: `effect:${e}`, name: EFFECT_NAMES[e], category: 'effects', effect: e, tags: {} })),
];

/**
 * The results for a category, search and tag picks. Every word of the search must match the name or a tag, and a
 * word starting with # matches tags only (as in Live). Within a tag group any picked tag matches; across groups all
 * must. Sorted by name.
 */
export function search(items: readonly LibraryItem[], category: LibraryCategory, query: string, picks: TagPicks): LibraryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (category !== 'all' && it.category !== category) return false;
    const tags = Object.values(it.tags).flat().map((t) => t.toLowerCase());
    for (const w of words) {
      if (w.startsWith('#')) { if (!tags.some((t) => t.startsWith(w.slice(1)))) return false; }
      else if (!it.name.toLowerCase().includes(w) && !tags.some((t) => t.startsWith(w))) return false;
    }
    for (const [group, picked] of Object.entries(picks)) {
      if (picked.length && !picked.some((p) => it.tags[group]?.includes(p))) return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Collections: up to seven colours per item, kept by item id. Keys 1 to 7 toggle a colour, 0 clears them. */
export type Collections = Record<string, number[]>;
export function collect(all: Collections, id: string, key: number): Collections {
  const next = { ...all };
  if (key === 0) { delete next[id]; return next; }
  const have = next[id] ?? [];
  const list = have.includes(key) ? have.filter((k) => k !== key) : [...have, key].sort((a, b) => a - b);
  if (list.length) next[id] = list; else delete next[id];
  return next;
}

/**
 * The preview's shape: what the audition plays (three notes 180 ms apart, or four drum hits), drawn from the sound's
 * envelope as peaks for the preview strip, with its length in seconds. Nothing for an effect.
 */
export function previewShape(item: LibraryItem, slices = 64): { peaks: number[]; seconds: number } | null {
  if (!item.instrument) return null;
  const drums = item.instrument === 'drums';
  const gap = 0.18;
  const hold = item.instrument === 'pad' ? 0.6 : 0.3;
  const env = item.sound ?? { attack: 0.005, decay: 0.15 * (item.kit?.decay ?? 1), sustain: 0, release: 0.08 };
  const count = drums ? 4 : 3;
  const seconds = (count - 1) * gap + hold + env.release;
  const level = (t: number) => {
    if (t < 0) return 0;
    if (t < env.attack) return t / Math.max(env.attack, 1e-3);
    if (t < hold) return Math.max(env.sustain, 1 - ((t - env.attack) / Math.max(env.decay, 1e-3)) * (1 - env.sustain));
    return Math.max(0, Math.max(env.sustain, drums ? 0 : 0.2) * (1 - (t - hold) / Math.max(env.release, 1e-3)));
  };
  const peaks = Array.from({ length: slices }, (_, i) => {
    const t = (i / (slices - 1)) * seconds;
    let sum = 0;
    for (let n = 0; n < count; n++) sum += level(t - n * gap);
    return Math.min(1, sum * 0.8);
  });
  return { peaks, seconds };
}
