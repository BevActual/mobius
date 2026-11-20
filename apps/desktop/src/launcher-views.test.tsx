import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GRID_COLS, Launcher, everyApp, marked, stepFrom, type LauncherItem } from './Launcher';

const base = { open: true, onClose: () => {}, tabs: [], onNewTab: () => {}, onActivateTab: () => {}, onOpenApp: () => {}, inline: true, recent: [], onOpenMobius: () => {} };

describe('launcher views', () => {
  it('ends the pinned row with All apps, and labels its sections in sentence case', () => {
    const html = renderToStaticMarkup(<Launcher {...base} pinned={['mail', 'notes']} places={{ abilities: () => {} }} />);
    expect(html).toMatch(/data-kind="pinned"[^>]*>.*Mail.*Notes.*All apps/s);
    expect(html).toContain('>Pinned<');
    expect(html).not.toContain('Right-click an app to pin');
  });

  it('starts with what waits for you and the agents at work, but Enter still opens the first pinned app', () => {
    const home = {
      waiting: [1, 2, 3, 4].map((n) => ({ id: `w${n}`, label: `Chat ${n}`, detail: 'Needs your answer', app: 'agent' as const, run: () => {} })),
      agents: [{ id: 'scout:1', name: 'Scout', state: 'working' as const, detail: 'Find a sled slot', run: () => {} }],
    };
    const html = renderToStaticMarkup(<Launcher {...base} pinned={['mail']} home={home} />);
    expect(html).toContain('>Waiting for you<');
    expect(html).toContain('>Agents at work<');
    expect(html).toContain('Chat 3');
    expect(html).not.toContain('Chat 4');
    expect(html).toMatch(/Waiting for you.*Agents at work.*Scout.*Pinned/s);
    expect(html).toMatch(/aria-selected="true"[^>]*>(?:(?!aria-selected).)*Mail/s);
  });

  it('offers the AI commands first when something was selected, and asks what is typed about it', () => {
    const ask = () => () => {};
    const empty = renderToStaticMarkup(<Launcher {...base} pinned={['mail']} askInline={ask} about={{ text: 'Meet at 3 by the dock' }} />);
    expect(empty).toContain('>About the selection<');
    expect(empty).toContain('“Meet at 3 by the dock”');
    expect(empty).toMatch(/aria-selected="true"[^>]*>(?:(?!aria-selected).)*Summarize/s);
    const typed = renderToStaticMarkup(<Launcher {...base} pinned={['mail']} askInline={ask} about={{ text: 'Meet' }} answered={{ question: 'translate to french', answer: { conversation: 'c', text: '', state: 'asking', sources: [] } }} />);
    expect(typed).toContain('Continue in Mobius');
    const done = { conversation: 'c', text: 'Maya.', state: 'done' as const, sources: [] };
    const asked = renderToStaticMarkup(<Launcher {...base} pinned={['mail']} askInline={ask} about={{ text: 'Meet' }} answered={{ question: 'who replies?', answer: done }} />);
    expect(asked).toContain('Save as a command');
    const ran = renderToStaticMarkup(<Launcher {...base} pinned={['mail']} askInline={ask} about={{ text: 'Meet' }} answered={{ question: 'Summarize', answer: done }} />);
    expect(ran).not.toContain('Save as a command');
    const none = renderToStaticMarkup(<Launcher {...base} pinned={['mail']} about={{ text: 'Meet' }} />);
    expect(none).not.toContain('About the selection');
  });

  it('shows every app A to Z in All apps, then Add apps', () => {
    const html = renderToStaticMarkup(<Launcher {...base} startIn="apps" pinned={['mail']} places={{ abilities: () => {} }} />);
    const names = [...html.matchAll(/class="launcher-tile-name">([^<]+)</g)].map((m) => m[1]);
    expect(names.at(-1)).toBe('Add apps');
    const apps = names.slice(0, -1);
    expect(apps).toEqual([...apps].sort((a, b) => a!.localeCompare(b!)));
    expect(apps.length).toBe(everyApp().length);
    expect(html).toContain('placeholder="Find an app"');
    expect(html).toContain('>Back<');
  });

  it('moves through All apps as a grid', () => {
    const kinds: LauncherItem['kind'][] = Array.from({ length: GRID_COLS * 2 + 1 }, () => 'grid');
    expect(stepFrom(kinds, 0, 'ArrowRight')).toBe(1);
    expect(stepFrom(kinds, 1, 'ArrowDown')).toBe(GRID_COLS + 1);
    expect(stepFrom(kinds, GRID_COLS + 1, 'ArrowDown')).toBe(GRID_COLS * 2);
    expect(stepFrom(kinds, GRID_COLS - 1, 'ArrowRight')).toBe(GRID_COLS - 1);
  });

  it('marks the typed letters in a name', () => {
    expect(renderToStaticMarkup(<>{marked('Calendar', 'len')}</>)).toBe('Ca<mark class="launcher-match">len</mark>dar');
    expect(marked('Mail', 'x')).toBe('Mail');
  });
});

import { commandsOnly } from './Launcher';
describe('launcher commands only', () => {
  const commands = [{ label: 'New message', detail: 'Mail · Ctrl+N' }, { label: 'New event', detail: 'Calendar' }, { label: 'Print', detail: 'File' }];
  it('lists only commands after ">", matched on their name and where they live', () => {
    expect(commandsOnly(commands, 'new')).toBeNull();
    expect(commandsOnly(commands, '>')!.map((c) => c.label)).toEqual(['New message', 'New event', 'Print']);
    expect(commandsOnly(commands, '> new')!.map((c) => c.label)).toEqual(['New message', 'New event']);
    expect(commandsOnly(commands, '>calendar')!.map((c) => c.label)).toEqual(['New event']);
  });
});

import { noteChoice, rankByChoice } from './Launcher';
describe('launcher choice memory', () => {
  const items = [{ id: 'ask', kind: 'ask' }, { id: 'app-notes', kind: 'app' }, { id: 'app-knowledge', kind: 'app' }, { id: 'item-a', kind: 'item' }, { id: 'item-b', kind: 'item' }];
  it('puts what was picked for the same first letters first within its kind, and leaves the rest in order', () => {
    let c = noteChoice({}, 'kno', 'app-knowledge');
    c = noteChoice(c, 'know', 'item-b');
    expect(rankByChoice(items, c, 'kn').map((i) => i.id)).toEqual(['ask', 'app-notes', 'app-knowledge', 'item-a', 'item-b']);
    expect(rankByChoice(items, c, 'knowl').map((i) => i.id)).toEqual(['ask', 'app-knowledge', 'app-notes', 'item-b', 'item-a']);
    expect(rankByChoice(items, {}, 'kno').map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
  it('learns nothing from an empty query and keeps 20 per prefix', () => {
    expect(noteChoice({}, '  ', 'x')).toEqual({});
    let c = {};
    for (let i = 0; i < 25; i += 1) c = noteChoice(c, 'abc', `id-${i}`);
    expect(Object.keys((c as Record<string, object>).abc!)).toHaveLength(20);
  });
});

import { landInStage } from './Launcher';

describe('opening an app from the launcher', () => {
  const stage = (inside: unknown[]) => {
    let focused = false;
    return { contains: (n: unknown) => inside.includes(n), focus: () => { focused = true; }, get focused() { return focused; } };
  };
  it('gives the keyboard to the work area when focus went back to the composer', () => {
    const s = stage([]);
    expect(landInStage(s as never, {} as Element)).toBe(true);
    expect(s.focused).toBe(true);
  });
  it('leaves it where the app put it', () => {
    const list = {} as Element;
    const s = stage([list]);
    expect(landInStage(s as never, list)).toBe(false);
    expect(s.focused).toBe(false);
  });
});

describe('an answer given in the launcher', () => {
  it('shows its links and marks as the panel does, not as written', () => {
    const answer = { conversation: 'c', state: 'done' as const, sources: ['Calendar'], text: 'It is [Crash test, 9:00 at Northfield](trust:yours "Calendar · Crash test").' };
    const html = renderToStaticMarkup(<Launcher {...base} answered={{ question: 'when is the crash test?', answer }} />);
    expect(html).toContain('Crash test, 9:00 at Northfield');
    expect(html).not.toContain('trust:yours');
    expect(html).toContain('Calendar');
  });
});
