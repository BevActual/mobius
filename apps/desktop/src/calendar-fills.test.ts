import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE } from './calendar-view';

/** An event's fill is its calendar's colour mixed into the paper (calendar.css); its title is ink. */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * t + b[i]! * (1 - t));
const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
/** Each theme's paper, ink and fill strength, as tokens.css names them. */
function theme(block: string): { paper: string; ink: string; fill: number } {
  const at = tokens.indexOf(block);
  const body = tokens.slice(at, tokens.indexOf('\n}', at));
  const take = (name: string) => body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  return { paper: take('paper')!, ink: take('ink')!, fill: Number((take('event-fill') ?? '14%').replace('%', '')) / 100 };
}

describe('event fills', () => {
  const themes = { light: theme(':root {'), dark: theme('@media (prefers-color-scheme: dark)'), mid: theme(':root[data-theme="mid"]'), cool: theme(':root[data-theme="cool"]') };
  it('use a stronger tint on dark than on light', () => {
    expect(themes.light.fill).toBeCloseTo(0.14);
    expect(themes.dark.fill).toBeCloseTo(0.22);
  });
  for (const [name, t] of Object.entries(themes)) {
    it(`keep the title at 4.5:1 or more on every calendar colour (${name})`, () => {
      for (const colour of PALETTE) expect(contrast(rgb(t.ink), mix(rgb(colour), rgb(t.paper), t.fill)), `${colour} on ${name}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
