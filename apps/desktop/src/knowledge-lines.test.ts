import { describe, expect, it } from 'vitest';
import { readable } from './knowledge-lines';

describe('a page line as people read it', () => {
  it('takes the Markdown off headings, list items, checklist items and quotes', () => {
    expect(readable('# Battery pack')).toEqual({ block: 'h1', text: 'Battery pack' });
    expect(readable('## Spec')).toEqual({ block: 'h2', text: 'Spec' });
    expect(readable('#### Notes')).toEqual({ block: 'h3', text: 'Notes' });
    expect(readable('- Balance window 40 mV')).toEqual({ block: 'li', text: 'Balance window 40 mV' });
    expect(readable('2. Fit the packs')).toEqual({ block: 'li', text: 'Fit the packs' });
    expect(readable('- [ ] Book the sled')).toEqual({ block: 'todo', text: 'Book the sled' });
    expect(readable('- [x] Confirm the week')).toEqual({ block: 'done', text: 'Confirm the week' });
    expect(readable('> Sam needs the curves')).toEqual({ block: 'quote', text: 'Sam needs the curves' });
  });

  it('takes off bold, italic, code and link marks, and leaves plain words alone', () => {
    expect(readable('The hold lasts until **Friday**, see [Supplier notes](Supplier%20notes.md).').text).toBe('The hold lasts until Friday, see Supplier notes.');
    expect(readable('Run `cell_balance` *twice*').text).toBe('Run cell_balance twice');
    expect(readable('8 * 60 kWh packs')).toEqual({ block: 'p', text: '8 * 60 kWh packs' });
    expect(readable('')).toEqual({ block: 'p', text: '' });
  });
});
