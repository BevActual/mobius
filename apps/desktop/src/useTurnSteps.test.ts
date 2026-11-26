import { describe, expect, it } from 'vitest';
import type { Item } from './conversation';
import { matchSteps } from './useTurnSteps';

const tool = (id: string, callId: string, name = 'files.write'): Item => ({ kind: 'tool', id, callId, name, status: 'done' });
const step = (callId: string, nth: number, files: string[]) => ({ callId, tool: 'files.write', nth, files, undone: false });

describe('each step of the last turn, matched to its row', () => {
  it('tells apart calls a model gave the same id, by how many came before', () => {
    const items: Item[] = [
      { kind: 'user', id: 'u1', text: 'earlier' }, tool('t0', 'call_1'),
      { kind: 'user', id: 'u2', text: 'write two notes' }, tool('t1', 'call_1'), tool('t2', 'call_1', 'files.read'), tool('t3', 'call_1'),
    ];
    const matched = matchSteps(items, [step('call_1', 0, ['notes/A.md']), step('call_1', 1, ['notes/B.md'])]);
    expect(matched.get('t1')?.files).toEqual(['notes/A.md']);
    expect(matched.get('t3')?.files).toEqual(['notes/B.md']);
    expect(matched.has('t0') || matched.has('t2')).toBe(false);
  });
});
