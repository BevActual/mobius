/**
 * The dot matrix's patterns (docs/design/instrument.md, "Personality"): one movement for each kind of work, so the
 * matrix shows what Mobius or an agent is doing, not just that it is busy. Pure functions of place and time, drawn by
 * DotMatrix and DotCharacter.
 */

/** What the matrix shows. The first five move; the last three hold still apart from a blink. */
export type MatrixMode = 'thinking' | 'reading' | 'searching' | 'writing' | 'working' | 'waiting' | 'done' | 'stopped';

export const MOVING: readonly MatrixMode[] = ['thinking', 'reading', 'searching', 'writing', 'working'];

const READS = /\.(read|list|search|tabs|free)$/;
const WRITES = /\.(write|edit|add|update|draft|draft_replies|move|sort|suggest|type|click)$/;

/** The mode for a tool call: web pages are searching, reads are reading, changes are writing, the rest is working. */
export function modeOfTool(name: string, status?: string): MatrixMode {
  if (status === 'waiting') return 'waiting';
  if (/^(web|search)[._]/.test(name) || name === 'browser.open' || name === 'browser.read') return 'searching';
  if (name === 'todo.write') return 'thinking';
  if (READS.test(name)) return 'reading';
  if (WRITES.test(name)) return 'writing';
  return 'working';
}

/** 0 to 1: how lit the dot at (x, y) is. The matrix is cols × rows; t is seconds. */
export function dotLevel(mode: MatrixMode, x: number, y: number, t: number, cols: number, rows: number): number {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const dim = 0.14;
  switch (mode) {
    case 'thinking': {
      // Slow, uneven breathing, brighter in the middle.
      const n = Math.sin(x * 0.7 + t * 1.3) * Math.sin(y * 1.1 - t * 0.9) + Math.sin((x + y) * 0.35 + t * 0.6);
      const near = Math.max(0, 1 - Math.hypot(x - cx, (y - cy) * 2) / Math.max(cols * 0.6, 1));
      return clamp(dim + Math.max(0, (n * 0.25 + 0.3) * near + 0.1));
    }
    case 'reading': {
      // A bright column scans across, like a reading head.
      const col = ((t * 9) % (cols + 6)) - 3;
      const d = Math.abs(x - col);
      return d < 1 ? 0.95 : d < 2 ? 0.5 : d < 3 ? 0.25 : dim;
    }
    case 'searching': {
      // A ping spreads from the centre and fades.
      const reach = Math.max(cols, rows * 2) * 0.7;
      const r = (t * 7) % reach;
      const d = Math.abs(Math.hypot(x - cx, (y - cy) * 2.2) - r);
      return clamp(dim + Math.max(0, 0.85 - d * 0.45) * (1 - r / reach));
    }
    case 'writing': {
      // Dots fill row by row like a line of type, with a bright cursor.
      const cells = cols * rows;
      const at = Math.floor(t * 14) % (cells + 8);
      const i = y * cols + x;
      if (i === at) return 1;
      if (i < at) return (x * 7 + y * 13) % 5 === 0 ? 0.3 : 0.75;
      return dim;
    }
    case 'working': {
      // Columns jump like a level meter.
      const step = Math.floor(t * 6);
      const h = Math.abs(Math.sin(x * 1.9 + step * 1.7)) * Math.abs(Math.cos(x * 0.6 + step));
      return rows - 1 - y < Math.round(h * rows) ? 0.85 : dim;
    }
    case 'waiting': {
      // Still, with two dots blinking slowly near the end, like a pause.
      const on = Math.floor(t * 1.6) % 2 === 0;
      const row = Math.floor(cy);
      if (y === row && (x === cols - 4 || x === cols - 2)) return on ? 1 : 0.3;
      return dim;
    }
    case 'done': {
      // A tick, drawn left to right.
      const drawn = Math.min(TICK.length, Math.floor(t * 10));
      const ox = Math.floor(cx) - 3;
      const oy = Math.max(0, Math.floor(cy) - 2);
      for (let i = 0; i < drawn; i += 1) if (x === TICK[i]![0] + ox && y === TICK[i]![1] + oy) return 1;
      return dim;
    }
    case 'stopped': {
      const ox = Math.floor(cx) - 2;
      const oy = Math.max(0, Math.floor(cy) - 2);
      return CROSS.some(([a, b]) => x === a + ox && y === b + oy) ? 0.95 : dim;
    }
  }
}

const TICK: [number, number][] = [[0, 2], [1, 3], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0]];
const CROSS: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [0, 4], [1, 3], [3, 1], [4, 0]];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/* ---- Agent characters ---------------------------------------------------------------------------------------- */

/** How an agent is: at rest it shows a face; while it works its body becomes the matrix. */
export type CharacterState = 'idle' | 'waiting' | 'done' | 'failed' | 'paused' | MatrixMode;

/** True when the agent shows its face (it is still), false while it works and its body shows the work. */
export function showsFace(state: CharacterState): boolean {
  return state === 'idle' || state === 'waiting' || state === 'done' || state === 'failed' || state === 'paused' || state === 'stopped';
}

export const CHARACTER_SIZE = 11;

/** Five body shapes on an 11 × 11 grid: round, antenna, ears, box, tall. */
const BODIES: string[][] = [
  ['00011111000', '00111111100', '01111111110', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '01111111110', '00111111100', '00011111000'],
  ['00000100000', '00000100000', '00001110000', '01111111110', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '01111111110'],
  ['11000000011', '11100000111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '01111111110', '00111111100'],
  ['00000000000', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '01100000110'],
  ['00111111100', '01111111110', '01111111110', '01111111110', '01111111110', '01111111110', '01111111110', '01111111110', '01111111110', '01111111110', '01100000110'],
];

/** A steady number from a name, so an agent keeps its body and colour. */
export function nameHash(name: string): number {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

export function bodyOf(name: string): string[] {
  return BODIES[nameHash(name) % BODIES.length]!;
}

/** The content colours an agent can take (tokens.css), in a steady order from its name. */
export const CHARACTER_COLOURS = ['violet', 'teal', 'amber', 'coral', 'blue', 'green', 'pink'] as const;
export type CharacterColour = (typeof CHARACTER_COLOURS)[number];

export function colourOf(name: string): CharacterColour {
  return CHARACTER_COLOURS[(nameHash(name) >>> 8) % CHARACTER_COLOURS.length]!;
}

/** The dots drawn in ink for the face: two eyes, sometimes a mouth line. t is seconds, for blinks and glances. */
export function faceDots(state: CharacterState, t: number): [number, number][] {
  switch (state) {
    case 'waiting': {
      const blink = t % 2.4 > 2.2;
      return blink ? [[2, 5], [3, 5], [7, 5], [8, 5]] : [[3, 4], [3, 5], [7, 4], [7, 5], [2, 3], [8, 3]];
    }
    case 'done':
      return [[2, 5], [3, 4], [4, 5], [6, 5], [7, 4], [8, 5], [4, 7], [5, 8], [6, 7]];
    case 'failed':
    case 'stopped':
      return [[2, 4], [4, 4], [3, 5], [2, 6], [4, 6], [6, 4], [8, 4], [7, 5], [6, 6], [8, 6]];
    case 'paused':
      return [[2, 5], [3, 5], [4, 5], [6, 5], [7, 5], [8, 5]];
    default: {
      // Idle: looks left, ahead and right in turn, and blinks now and then.
      const blink = t % 4 > 3.85;
      const look = (Math.floor(t / 2) % 3) - 1;
      return blink ? [[3 + look, 5], [4 + look, 5], [6 + look, 5], [7 + look, 5]] : [[3 + look, 4], [3 + look, 5], [7 + look, 4], [7 + look, 5]];
    }
  }
}
