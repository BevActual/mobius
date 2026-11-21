import { describe, expect, it } from 'vitest';
import { citeOf, claimCounts, followUpPrompt, isWaiting, nextQuestions, researchPrompt, researchSteps, sourcesOf, startingPage, titleFor } from './research-format';

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
    expect(quick).toContain('Cite only pages you read with web.read');
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

describe('research as it goes', () => {
  const file = 'research/Research/Porto hotels.md';
  const items = [
    { kind: 'user', id: 'u0', text: 'something else' },
    { kind: 'user', id: 'u1', text: `Research this… Then replace the whole of ${file} with the report` },
    { kind: 'tool', id: 't1', callId: 'c1', name: 'web.search', status: 'done', args: { query: 'porto hotels ribeira' } },
    { kind: 'tool', id: 't2', callId: 'c2', name: 'web.read', status: 'done', args: { url: 'https://www.timeout.com/porto/hotels' } },
    { kind: 'tool', id: 't3', callId: 'c3', name: 'files.read', status: 'done' },
    { kind: 'tool', id: 't4', callId: 'c4', name: 'web.read', status: 'running', args: { url: 'https://visitporto.travel/stay' } },
  ] as const;

  it('lists the searches and reads of the turn writing the report', () => {
    expect(researchSteps(items as never, file)).toEqual([
      { kind: 'search', text: 'porto hotels ribeira', status: 'done' },
      { kind: 'read', text: 'timeout.com', url: 'https://www.timeout.com/porto/hotels', status: 'done' },
      { kind: 'read', text: 'visitporto.travel', url: 'https://visitporto.travel/stay', status: 'running' },
    ]);
    expect(researchSteps(items as never, 'research/Research/Other.md')).toEqual([]);
  });

  it('takes the next questions out of the report', () => {
    const { body, questions } = nextQuestions('# Porto\n\nAnswer.\n\n## Sources\n- [A](https://a.example)\n\n## Next questions\n- Which area is quietest?\n- **How far** is the airport?\n- What about May?\n- A fourth\n');
    expect(questions).toEqual(['Which area is quietest?', 'How far is the airport?', 'What about May?']);
    expect(body).toBe('# Porto\n\nAnswer.\n\n## Sources\n- [A](https://a.example)\n');
    expect(nextQuestions('# No questions\n').questions).toEqual([]);
  });

  it('numbers a fact by the source it came from', () => {
    const sources = sourcesOf('## Sources\n- [Porto hotels](https://www.timeout.com/porto) — areas\n- [Stay](https://visitporto.travel/stay) — prices\n');
    expect(citeOf('visitporto.travel', sources)?.n).toBe(2);
    expect(citeOf('www.timeout.com', sources)?.n).toBe(1);
    expect(citeOf('Time Out', sources)?.n).toBe(1);
    expect(citeOf('nowhere.example', sources)).toBeNull();
  });
});
