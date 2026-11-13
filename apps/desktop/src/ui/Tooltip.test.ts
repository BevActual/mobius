import { describe, expect, it } from 'vitest';
import { splitTitle } from './Tooltip';

describe('tooltip titles', () => {
  it('draws a shortcut in brackets as key caps after the name', () => {
    expect(splitTitle('Undo (Ctrl+Z)')).toEqual({ name: 'Undo', keys: [['Ctrl', 'Z']] });
    expect(splitTitle('Create component (Ctrl+Alt+K)')).toEqual({ name: 'Create component', keys: [['Ctrl', 'Alt', 'K']] });
    expect(splitTitle('Previous photo (←)')).toEqual({ name: 'Previous photo', keys: [['←']] });
    expect(splitTitle('Back (Alt+Left)')).toEqual({ name: 'Back', keys: [['Alt', 'Left']] });
    expect(splitTitle('Close (Esc)')).toEqual({ name: 'Close', keys: [['Esc']] });
    expect(splitTitle('Settings (Ctrl+,)')).toEqual({ name: 'Settings', keys: [['Ctrl', ',']] });
  });
  it('reads several shortcuts for one action, and the plus key itself', () => {
    expect(splitTitle('Zoom (− and +)')).toEqual({ name: 'Zoom', keys: [['−'], ['+']] });
    expect(splitTitle('Zoom in (Ctrl+=)')).toEqual({ name: 'Zoom in', keys: [['Ctrl', '=']] });
  });
  it('keeps a bracket that is not a shortcut as part of the name', () => {
    expect(splitTitle('Forget this line (you can undo it)')).toEqual({ name: 'Forget this line (you can undo it)', keys: [] });
    expect(splitTitle('Hide Mobius')).toEqual({ name: 'Hide Mobius', keys: [] });
  });
});
