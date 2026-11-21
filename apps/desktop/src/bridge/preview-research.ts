/** The preview's Research app: one finished report kept in memory, so the report view can be seen without the core. */
const now = Date.now();
const REPORT = `# Where to stay near LX Factory for the offsite

Alcântara and Santos are the two areas within a short walk of LX Factory. Mid-range hotels there run about €140 to €190 a night in March, and Belém is a cheaper fallback one tram stop away.

## Walking distance

Alcântara is closest: [most hotels are under ten minutes on foot from the LX Factory gate](trust:web "https://lisbon-walks.example/alcantara"). Santos is [a 20-minute walk along the river, or two stops on tram 15](trust:web "https://carris-guide.example/tram-15"), and it has more places to eat in the evening.

## What it costs in March

March is shoulder season: [mid-range rooms in Alcântara averaged €152 a night last March](trust:web "https://stay-index.example/lisbon/march"), and [Santos ran about €20 higher](trust:web "https://stay-index.example/lisbon/march"). [Group rates for ten or more rooms are usually 10 to 15% lower when booked six weeks ahead](trust:web "https://offsite-planner.example/group-rates").

## Worth knowing

- The 25 de Abril bridge runs over Alcântara, so [rooms facing it can be noisy](trust:web "https://lisbon-walks.example/alcantara"). Ask for the river side.
- I could not find March prices for Belém's two larger hotels. Their sites quote only on request.

## Sources

- [Walking Lisbon: Alcântara](https://lisbon-walks.example/alcantara) — walking times and the bridge noise
- [Tram 15, stop by stop](https://carris-guide.example/tram-15) — the Santos to Alcântara trip
- [Lisbon hotel price index, March](https://stay-index.example/lisbon/march) — average rates by area
- [Booking a team offsite](https://offsite-planner.example/group-rates) — group discounts

## Next questions

- Which of these hotels have a meeting room for 14?
- How do we get from the airport to Alcântara?
- What is on at LX Factory in the week of 23 June?
`;
const TEXT: Record<string, string> = { 'Research/Where to stay near LX Factory.md': REPORT };
const MODIFIED: Record<string, number> = { 'Research/Where to stay near LX Factory.md': now - 2 * 3_600_000 };
const title = (path: string) => path.slice(path.indexOf('/') + 1, -3);

export const PREVIEW_RESEARCH: Record<string, (...args: never[]) => unknown> = {
  'research.list': () => [{ name: 'Research', pages: Object.keys(TEXT).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now })) }],
  'research.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : { ok: false, message: 'that report is not there' })) as never,
  'research.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'research.createNotebook': ((name: string) => ({ name })) as never,
  'research.createPage': ((folder: string, name?: string) => {
    const path = `${folder}/${(name ?? '').trim() || 'Untitled'}.md`;
    TEXT[path] = `# ${title(path)}\n`;
    MODIFIED[path] = Date.now();
    return { path, content: TEXT[path], modified: MODIFIED[path] };
  }) as never,
  'research.remove': ((path: string) => { delete TEXT[path]; return { path }; }) as never,
  'research.search': ((query: string) => Object.entries(TEXT).filter(([, t]) => t.toLowerCase().includes(query.toLowerCase())).map(([path, t]) => ({ path, title: title(path), notebook: path.split('/')[0], line: t.split('\n').find((l) => l.toLowerCase().includes(query.toLowerCase())) ?? '' }))) as never,
};
