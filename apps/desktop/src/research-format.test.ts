import { describe, expect, it } from 'vitest';
import { claimCounts, followUpPrompt, isWaiting, researchPrompt, sourcesOf, startingPage, titleFor } from './research-format';

const REPORT = `# Lisbon venues for twelve

LX Factory fits [up to 40 people](trust:web "lxfactory.com") and books out early.

## Price

Half-day rooms cost [about $380](trust:web "venue.example").

See also [a blog](https://blog.example/post).

## Sources

- [LX Factory spaces](https://lxfactory.com/spaces) — capacity and booking
- [Venue prices](https://www.venue.example/prices): half-day rates
- [LX Factory spaces](https://lxfactory.com/spaces) — again
- [Not a page](javascript:alert(1))
`;

describe('research', () => {
  it('starts a page from the question and knows it is waiting', () => {
    expect(titleFor('  what are the best venues in lisbon for 12 people?  ')).toBe('What are the best venues in lisbon for 12 people');
    expect(titleFor('x'.repeat(100)).length).toBeLessThanOrEqual(71);
    const page = startingPage('Best venues?');
    expect(page.startsWith('# Best venues\n\n> Best venues?')).toBe(true);
    expect(isWaiting(page)).toBe(true);
    expect(isWaiting(REPORT)).toBe(false);
  });

  it('asks for searching, reading and a report written into the page', () => {
    const quick = researchPrompt('Best venues?', 'quick', 'research/Research/Best venues.md');
    expect(quick).toContain('web.search two or three times');
    expect(quick).toContain('replace the whole of research/Research/Best venues.md');
    expect(quick).toContain('## Sources');
    expect(researchPrompt('Best venues?', 'thorough', 'f.md')).toContain('at least 10');
    expect(followUpPrompt('How about Porto?', 'f.md')).toContain('(f.md): How about Porto?');
  });

  it('lists the sources under Sources once each, with what each gave', () => {
    expect(sourcesOf(REPORT)).toEqual([
      { title: 'LX Factory spaces', url: 'https://lxfactory.com/spaces', site: 'lxfactory.com', note: 'capacity and booking' },
      { title: 'Venue prices', url: 'https://www.venue.example/prices', site: 'venue.example', note: 'half-day rates' },
    ]);
    // Without a Sources section, every link counts.
    expect(sourcesOf('Read [this](https://a.example/x) and [that](https://b.example/).').map((s) => s.site)).toEqual(['a.example', 'b.example']);
    expect(claimCounts(REPORT)).toEqual({ web: 2, unsure: 0 });
  });
});
