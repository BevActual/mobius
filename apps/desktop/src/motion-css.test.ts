import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION_ICONS, ACTION_LABELS } from './ContextMenu';

const here = path.dirname(fileURLToPath(import.meta.url));
const sheets = fs.readdirSync(here).filter((f) => f.endsWith('.css') && f !== 'tokens.css');

/** Every transition and animation declaration in the interface's style sheets, with where it is. */
function motionDeclarations(): Array<{ where: string; value: string }> {
  const out: Array<{ where: string; value: string }> = [];
  for (const f of sheets) {
    const text = fs.readFileSync(path.join(here, f), 'utf8');
    for (const m of text.matchAll(/(?:transition|animation)(?:-duration|-timing-function|-delay)?\s*:\s*([^;}]*)/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ where: `${f}:${line}`, value: m[1]!.trim() });
    }
  }
  return out;
}

describe('one timing for all motion', () => {
  it('takes every duration from the tokens (--dur-fast, --dur-med, --dur-slow, --dur-loop...), never a number of its own', () => {
    const raw = motionDeclarations().filter((d) => /(?<![\w.(-])(?!0m?s\b)\d*\.?\d+m?s(?![\w-])/.test(d.value));
    expect(raw.map((d) => `${d.where} ${d.value}`)).toEqual([]);
  });

  it('takes every easing from the tokens (--ease, --ease-exit); linear only for what repeats or steps', () => {
    const raw = motionDeclarations().filter((d) => /(?<![-\w])ease(-in-out|-out|-in)?(?![-\w])|cubic-bezier\(/.test(d.value));
    expect(raw.map((d) => `${d.where} ${d.value}`)).toEqual([]);
  });

  it('stops every movement with Reduce Motion, keeping only fades', () => {
    const tokens = fs.readFileSync(path.join(here, 'tokens.css'), 'utf8');
    const reduce = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const token of ['--dur-fast', '--dur-med', '--dur-slow', '--dur-exit', '--dur-loop', '--dur-spin']) expect(reduce).toMatch(new RegExp(`${token}: 0m?s`));
    expect(reduce).not.toMatch(/--dur-fade: 0/);
  });
});

describe('standard actions', () => {
  it('have one icon and one name each', () => {
    expect(Object.keys(ACTION_ICONS).sort()).toEqual(Object.keys(ACTION_LABELS).sort());
    expect(Object.keys(ACTION_ICONS)).toEqual(expect.arrayContaining(['copy', 'cut', 'paste', 'delete', 'duplicate', 'rename', 'share', 'pin', 'unpin', 'move', 'open', 'reveal', 'undo']));
  });
});
