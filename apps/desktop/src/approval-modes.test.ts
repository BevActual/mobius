import { describe, expect, it } from 'vitest';
import { MODES, modeOf, nextMode } from './approval-modes';

describe('approval modes', () => {
  it('are named as the composer\'s Permission names them, over the stored names', () => {
    expect(MODES.map((m) => [m.id, m.name])).toEqual([['manual', 'Ask each time'], ['propose', 'Review changes'], ['smart', 'Auto']]);
  });

  it('read a saved Off as Auto', () => {
    expect(modeOf('off').name).toBe('Auto');
    expect(modeOf('propose').name).toBe('Review changes');
  });

  it('Shift+Tab goes round them in order', () => {
    expect(nextMode('manual')).toBe('propose');
    expect(nextMode('propose')).toBe('smart');
    expect(nextMode('smart')).toBe('manual');
    expect(nextMode('off')).toBe('manual');
  });
});
