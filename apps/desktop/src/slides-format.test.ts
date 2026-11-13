import { describe, expect, it } from 'vitest';
import { blankSlide, changedSlides, parseDeck, writeDeck } from './slides-format';

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
    expect(a).toEqual({ ...blankSlide(), style: 'warm', kicker: 'Offsite 2027', title: 'Lisbon, together', bullets: [], text: '', notes: 'Welcome everyone, 30 seconds.' });
    expect(b).toEqual({ ...blankSlide(), style: 'light', kicker: 'Why', title: 'Plan next year in one place', bullets: ['Three days, eight people', 'No laptops on day two'], text: 'Keep it short and friendly.', notes: 'Keep it short.' });
  });
  it('write back what they read, and an empty file is one blank slide', () => {
    const slides = parseDeck(DECK);
    expect(parseDeck(writeDeck(slides))).toEqual(slides);
    expect(writeDeck(slides)).toContain('<!-- style: warm -->\n### Offsite 2027\n## Lisbon, together\n\nNotes:\nWelcome everyone, 30 seconds.\n\n---\n\n### Why');
    expect(parseDeck('')).toHaveLength(1);
    const withBlank = writeDeck([...slides, blankSlide()]);
    expect(withBlank.endsWith('---\n\n<!-- slide -->\n')).toBe(true);
    expect(parseDeck(withBlank)).toHaveLength(3);
  });
  it('find the slides a turn added or changed', () => {
    const before = parseDeck(DECK);
    const after = [...before.slice(0, 1), { ...before[1]!, title: 'Plan 2027 together' }, { ...blankSlide(), kicker: 'Agenda', title: 'Three days' }];
    expect([...changedSlides(before, after)]).toEqual([1, 2]);
  });
});

describe('pictures, skipped slides and transitions', () => {
  const deck = '<!-- style: dark -->\n<!-- skip -->\n<!-- transition: push -->\n## Site visit\n\n![](Kickoff%20files/site.jpg)\n\n---\n\n## Next\n';
  it('reads them from comments and an image line, and writes them back the same', () => {
    const [first, second] = parseDeck(deck);
    expect(first).toMatchObject({ style: 'dark', skip: true, transition: 'push', title: 'Site visit', picture: 'Kickoff%20files/site.jpg', text: '' });
    expect(second).toMatchObject({ skip: false, transition: 'dissolve', picture: '' });
    expect(writeDeck(parseDeck(deck))).toBe(deck);
  });
  it('leaves an unknown transition as Dissolve and writes nothing for the defaults', () => {
    const [slide] = parseDeck('<!-- transition: spin -->\n## A');
    expect(slide!.transition).toBe('dissolve');
    expect(writeDeck([slide!])).toBe('## A\n');
  });
});
