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
