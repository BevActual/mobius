import { describe, expect, it } from 'vitest';
import { botFromConversation, mayTouch } from './bot-view';

describe('bots', () => {
  it('say what they may touch, from the per-app settings and the mode', () => {
    expect(mayTouch({ browser: 'always', notes: 'follow', tasks: 'follow', mail: 'off' }, 'Propose')).toBe('Off: Mail. Always asks: Browser. Everything else follows your mode, Propose.');
    expect(mayTouch({ browser: 'follow', notes: 'follow', tasks: 'follow' }, 'Act')).toBe('Every app follows your mode, Act.');
  });

  it('are made from a conversation: its title, and what was first asked', () => {
    expect(botFromConversation('Weekly review', 'Look at my tasks and calendar and plan the week')).toEqual({ name: 'Weekly review', instructions: 'Do this, as in the conversation “Weekly review”: Look at my tasks and calendar and plan the week', model: '' });
    expect(botFromConversation('  ', null)).toEqual({ name: 'New bot', instructions: '', model: '' });
  });
});
