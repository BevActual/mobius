import { describe, expect, it } from 'vitest';
import { chatModeOf, modesFor, nextChatMode, permissionOf, sendOptionsOf } from './chat-mode';

describe('Mode and Permission', () => {
  it('sends Ask as read-only and Plan as plan-only', () => {
    expect(sendOptionsOf('agent')).toEqual({});
    expect(sendOptionsOf('ask')).toEqual({ ask: true });
    expect(sendOptionsOf('plan')).toEqual({ plan: true });
    // Research is the window's own: the question becomes a Doc, and the host is sent an ordinary turn.
    expect(sendOptionsOf('research', 'calendar')).toEqual({ research: true });
  });
  it('goes Agent, Ask, Plan, Research, then Agent again', () => {
    expect([nextChatMode('agent'), nextChatMode('ask'), nextChatMode('plan'), nextChatMode('research')]).toEqual(['ask', 'plan', 'research', 'agent']);
  });
  it('offers an app its own modes after the shared four, and only there', () => {
    expect(modesFor('mail').map((m) => m.name)).toEqual(['Agent', 'Ask', 'Plan', 'Research', 'Triage']);
    expect(modesFor('notes').map((m) => m.name).at(-1)).toBe('Review');
    expect(modesFor('database').map((m) => m.name).at(-1)).toBe('Analyse');
    expect(modesFor('calendar')).toHaveLength(4);
    expect(modesFor()).toHaveLength(4);
    expect(nextChatMode('research', 'mail')).toBe('triage');
    expect(nextChatMode('triage', 'mail')).toBe('agent');
    expect(sendOptionsOf('triage', 'mail')).toEqual({ mode: 'triage' });
    // Triage chosen in Mail counts as Agent in Calendar.
    expect(sendOptionsOf('triage', 'calendar')).toEqual({});
    expect(chatModeOf('triage', 'calendar').name).toBe('Agent');
    expect(nextChatMode('triage', 'calendar')).toBe('ask');
  });
  it('maps the old approval modes onto the four permissions', () => {
    expect(permissionOf('manual', false).name).toBe('Ask each time');
    expect(permissionOf('propose', false).name).toBe('Review changes');
    expect(permissionOf('propose', true).name).toBe('Apply changes');
    expect(permissionOf('smart', false).short).toBe('Auto');
    expect(permissionOf('off', true).short).toBe('Auto');
  });
});
