import { describe, expect, it } from 'vitest';
import { cdTarget, historyStep, isClear, promptPath, tail } from './terminal-view';

describe('terminal', () => {
  it('knows cd, clear and how the folder shows', () => {
    expect(cdTarget('cd code/site')).toBe('code/site');
    expect(cdTarget('  cd  "my notes" ')).toBe('my notes');
    expect(cdTarget('cd')).toBe('~');
    expect(cdTarget('cd /d notes')).toBe('notes');
    expect(cdTarget('cdk deploy')).toBeNull();
    expect(cdTarget('echo cd x')).toBeNull();
    expect(isClear('cls')).toBe(true);
    expect(isClear('clear all')).toBe(false);
    expect(promptPath('')).toBe('~');
    expect(promptPath('code/site')).toBe('~/code/site');
  });

  it('walks the history and keeps long output short', () => {
    const h = ['ls', 'git status'];
    expect(historyStep(h, -1, true)).toBe(0);
    expect(historyStep(h, 1, true)).toBe(1);
    expect(historyStep(h, 0, false)).toBe(-1);
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    expect(tail(long, 100).hidden).toBe(400);
    expect(tail('a\nb').hidden).toBe(0);
  });
});
