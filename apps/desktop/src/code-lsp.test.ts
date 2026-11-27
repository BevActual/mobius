import { describe, expect, it } from 'vitest';
import type { CodeCompletion } from '@mobius/shared';
import { applyTextEdits, fitting, offsetOf, spansOf } from './code-lsp';
import { lineStarts } from './code-doc';

const item = (label: string): CodeCompletion => ({ label, kind: 'method', insert: label, caret: null, filter: label, from: null });

describe('language smarts', () => {
  it('turns lines and columns into offsets, kept within the line', () => {
    const text = 'ab\ncdef\n';
    const st = lineStarts(text);
    expect(offsetOf(st, text.length, 1, 2)).toBe(5);
    expect(offsetOf(st, text.length, 0, 9)).toBe(2);
    expect(offsetOf(st, text.length, 7, 0)).toBe(text.length);
  });

  it('makes edits last first, so earlier places stay right', () => {
    const text = 'let a = 1\nprint(a)\n';
    const edits = [{ line: 0, character: 4, endLine: 0, endCharacter: 5, text: 'total' }, { line: 1, character: 6, endLine: 1, endCharacter: 7, text: 'total' }];
    expect(applyTextEdits(text, lineStarts(text), edits)).toBe('let total = 1\nprint(total)\n');
    expect(spansOf(text, lineStarts(text), [...edits].reverse()).map((s) => s.from)).toEqual([4, 16]);
  });

  it('keeps the completions that fit what was typed, those that start with it first', () => {
    const items = [item('toString'), item('toFixed'), item('fixedTo')];
    expect(fitting(items, 'fix').map((i) => i.label)).toEqual(['fixedTo', 'toFixed']);
    expect(fitting(items, 'tS').map((i) => i.label)).toEqual(['toString']);
    expect(fitting(items, '')).toHaveLength(3);
  });
});
