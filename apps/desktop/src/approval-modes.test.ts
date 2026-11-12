import { describe, expect, it } from 'vitest';
import { MODES, modeOf, nextMode } from './approval-modes';

describe('approval modes', () => {
  it('are Ask first, Propose and Act, over the stored names', () => {
    expect(MODES.map((m) => [m.id, m.name])).toEqual([['manual', 'Ask first'], ['propose', 'Propose'], ['smart', 'Act']]);
  });

  it('read a saved Off as Act', () => {
    expect(modeOf('off').name).toBe('Act');
    expect(modeOf('propose').name).toBe('Propose');
  });

  it('Shift+Tab goes round them in order', () => {
    expect(nextMode('manual')).toBe('propose');
    expect(nextMode('propose')).toBe('smart');
    expect(nextMode('smart')).toBe('manual');
    expect(nextMode('off')).toBe('manual');
  });
});
