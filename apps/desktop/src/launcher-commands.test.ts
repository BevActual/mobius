import { describe, expect, it } from 'vitest';
import { commandName, withSaved, withoutSaved, MAX_SAVED } from './launcher-commands';

describe('commands you save', () => {
  it('names a command from its first line, without the question mark', () => {
    expect(commandName('who needs to reply to this?')).toBe('Who needs to reply to this');
    expect(commandName('list the dates in this\nas a table')).toBe('List the dates in this');
    expect(commandName('x'.repeat(50))).toHaveLength(40);
  });
  it('keeps the newest first, replaces the same name, and keeps at most 30', () => {
    let list = withSaved([], 'list the dates');
    list = withSaved(list, 'who replies?');
    list = withSaved(list, 'List the dates');
    expect(list.map((c) => c.label)).toEqual(['List the dates', 'Who replies']);
    expect(list[1]!.instruction).toBe('who replies?');
    for (let i = 0; i < 40; i++) list = withSaved(list, `q ${i}`);
    expect(list).toHaveLength(MAX_SAVED);
    expect(withoutSaved(list, list[0]!.id)).toHaveLength(MAX_SAVED - 1);
  });
});

import { callQuicklink, keepNamed, parseCreate, type Quicklink } from './launcher-commands';
describe('quicklinks and snippets', () => {
  it('reads what typing would create', () => {
    expect(parseCreate('quicklink maps maps.example/search?q={query}')).toEqual({ kind: 'quicklink', name: 'maps', url: 'https://maps.example/search?q={query}' });
    expect(parseCreate('quicklink team wiki https://wiki.example')).toEqual({ kind: 'quicklink', name: 'team wiki', url: 'https://wiki.example' });
    expect(parseCreate('quicklink maps')).toBeNull();
    expect(parseCreate('quicklink notes about cars')).toBeNull();
    expect(parseCreate('snippet sig: Best,\nAndrew')).toEqual({ kind: 'snippet', name: 'sig', text: 'Best,\nAndrew' });
    expect(parseCreate('snippet sig')).toBeNull();
  });
  it('calls a quicklink by its name, with what follows in {query}', () => {
    const links: Quicklink[] = [{ id: '1', name: 'maps', url: 'https://maps.example/?q={query}' }, { id: '2', name: 'wiki', url: 'https://wiki.example' }];
    expect(callQuicklink(links, 'maps cafe near me')).toMatchObject({ rest: 'cafe near me', url: 'https://maps.example/?q=cafe%20near%20me' });
    expect(callQuicklink(links, 'Wiki')).toMatchObject({ url: 'https://wiki.example' });
    expect(callQuicklink(links, 'mapsx')).toBeNull();
  });
  it('replaces a quicklink of the same name', () => {
    const list = keepNamed<Quicklink>(keepNamed<Quicklink>([], { name: 'maps', url: 'a' }), { name: 'Maps', url: 'b' });
    expect(list.map((l) => l.url)).toEqual(['b']);
  });
});
