import { describe, expect, it } from 'vitest';
import { changedSlides, parseDeck, writeDeck } from './slides-format';

const DECK = `<!-- style: warm -->
### Offsite 2027
# Lisbon, together
Notes: Welcome everyone, 30 seconds.

---

### Why
## Plan next year in one place
- Three days, eight people
- No laptops on day two

Keep it short and friendly.

Notes:
Keep it short.
`;

describe('decks', () => {
  it('read kicker, title, bullets, text, style and notes from Markdown', () => {
    const [a, b] = parseDeck(DECK);
    expect(a).toEqual({ style: 'warm', kicker: 'Offsite 2027', title: 'Lisbon, together', bullets: [], text: '', notes: 'Welcome everyone, 30 seconds.' });
    expect(b).toEqual({ style: 'light', kicker: 'Why', title: 'Plan next year in one place', bullets: ['Three days, eight people', 'No laptops on day two'], text: 'Keep it short and friendly.', notes: 'Keep it short.' });
  });
  it('write back what they read, and an empty file is one blank slide', () => {
    const slides = parseDeck(DECK);
    expect(parseDeck(writeDeck(slides))).toEqual(slides);
    expect(writeDeck(slides)).toContain('<!-- style: warm -->\n### Offsite 2027\n## Lisbon, together\n\nNotes:\nWelcome everyone, 30 seconds.\n\n---\n\n### Why');
    expect(parseDeck('')).toHaveLength(1);
    const withBlank = writeDeck([...slides, { style: 'light', kicker: '', title: '', bullets: [], text: '', notes: '' }]);
    expect(withBlank.endsWith('---\n\n<!-- slide -->\n')).toBe(true);
    expect(parseDeck(withBlank)).toHaveLength(3);
  });
  it('find the slides a turn added or changed', () => {
    const before = parseDeck(DECK);
    const after = [...before.slice(0, 1), { ...before[1]!, title: 'Plan 2027 together' }, { style: 'light' as const, kicker: 'Agenda', title: 'Three days', bullets: [], text: '', notes: '' }];
    expect([...changedSlides(before, after)]).toEqual([1, 2]);
  });
});
