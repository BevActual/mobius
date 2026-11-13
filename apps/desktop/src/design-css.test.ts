import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Design follows Instrument: outside the canvas, its stylesheet uses only the tokens (no colour or pixel size of its
 * own). The canvas draws the person's design at any zoom, so its section keeps its own values.
 */
const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'design.css'), 'utf8');
const frame = css.slice(0, css.indexOf('/* Canvas:'));

describe('design.css outside the canvas', () => {
  it('has a canvas section', () => {
    expect(css.indexOf('/* Canvas:')).toBeGreaterThan(0);
  });
  it('names no colour of its own', () => {
    expect(frame.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([]);
  });
  it('names no pixel size of its own', () => {
    expect(frame.replace(/\/\*[\s\S]*?\*\//g, '').match(/(?<![\w-])\d*\.?\d+px\b/g) ?? []).toEqual([]);
  });
});
