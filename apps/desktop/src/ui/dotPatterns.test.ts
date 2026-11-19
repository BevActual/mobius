import { describe, expect, it } from 'vitest';
import { bodyOf, colourOf, dotLevel, faceDots, modeOfTool, showsFace, MOVING, type MatrixMode } from './dotPatterns';

const frame = (mode: MatrixMode, t: number, cols = 24, rows = 6) =>
  Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => dotLevel(mode, x, y, t, cols, rows)));

describe('the dot matrix', () => {
  it('names the work from the tool: reading, searching, writing, working, waiting', () => {
    expect(modeOfTool('mail.read')).toBe('reading');
    expect(modeOfTool('calendar.list')).toBe('reading');
    expect(modeOfTool('browser.read')).toBe('searching');
    expect(modeOfTool('web.search')).toBe('searching');
    expect(modeOfTool('files.edit')).toBe('writing');
    expect(modeOfTool('mail.draft')).toBe('writing');
    expect(modeOfTool('design.render')).toBe('working');
    expect(modeOfTool('mail.send', 'waiting')).toBe('waiting');
  });

  it('keeps every dot between 0 and 1 in every mode', () => {
    for (const mode of [...MOVING, 'waiting', 'done', 'stopped'] as MatrixMode[]) {
      for (const t of [0, 0.4, 1.3, 7.9]) for (const row of frame(mode, t)) for (const v of row) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('moves while working and holds still while waiting, apart from its blink', () => {
    expect(frame('reading', 0.2)).not.toEqual(frame('reading', 0.9));
    expect(frame('writing', 0.2)).not.toEqual(frame('writing', 0.9));
    expect(frame('stopped', 0.2)).toEqual(frame('stopped', 5));
    const lit = (f: number[][]) => f.flat().filter((v) => v > 0.5).length;
    expect(lit(frame('waiting', 0))).toBe(2);
  });

  it('reading scans: the bright column moves to the right', () => {
    const brightest = (t: number) => frame('reading', t)[0]!.indexOf(Math.max(...frame('reading', t)[0]!));
    expect(brightest(0.6)).toBeGreaterThan(brightest(0.4));
  });
});

describe('agent characters', () => {
  it('keeps the same body and colour for the same name', () => {
    expect(bodyOf('Weekly P2 summary')).toBe(bodyOf('Weekly P2 summary'));
    expect(colourOf('Morning brief')).toBe(colourOf('Morning brief'));
    expect(bodyOf('Weekly P2 summary')).toHaveLength(11);
  });

  it('shows a face only while it is still', () => {
    for (const s of ['idle', 'waiting', 'done', 'failed', 'paused'] as const) expect(showsFace(s)).toBe(true);
    for (const s of MOVING) expect(showsFace(s)).toBe(false);
  });

  it('keeps its face inside the grid, and blinks now and then when idle', () => {
    for (const s of ['idle', 'waiting', 'done', 'failed', 'paused'] as const) {
      for (const [x, y] of faceDots(s, 1)) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(11); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(11); }
    }
    expect(faceDots('idle', 3.9)).not.toEqual(faceDots('idle', 3.0));
  });
});
