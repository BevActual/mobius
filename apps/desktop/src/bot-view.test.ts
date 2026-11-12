import { describe, expect, it } from 'vitest';
import { agentSchedules, botFromConversation, mayTouch, modelChoices } from './bot-view';

describe('bots', () => {
  it('say what they may touch, from the per-app settings and the mode', () => {
    expect(mayTouch({ browser: 'always', notes: 'follow', tasks: 'follow', mail: 'off' }, 'Propose')).toBe('Off: Mail. Always asks: Browser. Everything else follows your mode, Propose.');
    expect(mayTouch({ browser: 'follow', notes: 'follow', tasks: 'follow' }, 'Act')).toBe('Every app follows your mode, Act.');
  });

  it('are made from a conversation: its title, and what was first asked', () => {
    expect(botFromConversation('Weekly review', 'Look at my tasks and calendar and plan the week')).toEqual({ name: 'Weekly review', instructions: 'Do this, as in the conversation “Weekly review”: Look at my tasks and calendar and plan the week', model: '' });
    expect(botFromConversation('  ', null)).toEqual({ name: 'New agent', instructions: '', model: '' });
  });

  it('suggest each model in the catalog once', () => {
    expect(modelChoices({ current: 'a', groups: [
      { kind: 'subscription', id: 'x', name: 'X', active: true, error: null, models: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      { kind: 'local', id: 'l', name: 'L', active: false, error: null, models: [{ id: 'b', label: 'B' }, { id: 'c', label: 'C' }] },
    ] })).toEqual(['a', 'b', 'c']);
    expect(modelChoices(null)).toEqual([]);
  });

  it('find the schedules made with them, by name', () => {
    const at = (title: string) => ({ id: title, title, prompt: '', time: '08:00', days: [1], enabled: true, lastRunMs: null });
    expect(agentSchedules('Weekly summary', [at('weekly summary '), at('Other')]).map((s) => s.id)).toEqual(['weekly summary ']);
    expect(agentSchedules('  ', [at('')])).toEqual([]);
  });
});
