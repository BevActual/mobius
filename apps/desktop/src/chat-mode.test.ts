import { describe, expect, it } from 'vitest';
import { nextChatMode, permissionOf, sendOptionsOf } from './chat-mode';

describe('Mode and Permission', () => {
  it('sends Ask as read-only and Plan as plan-only', () => {
    expect(sendOptionsOf('agent')).toEqual({});
    expect(sendOptionsOf('ask')).toEqual({ ask: true });
    expect(sendOptionsOf('plan')).toEqual({ plan: true });
  });
  it('goes Agent, Ask, Plan, then Agent again', () => {
    expect([nextChatMode('agent'), nextChatMode('ask'), nextChatMode('plan')]).toEqual(['ask', 'plan', 'agent']);
  });
  it('maps the old approval modes onto the four permissions', () => {
    expect(permissionOf('manual', false).name).toBe('Ask each time');
    expect(permissionOf('propose', false).name).toBe('Review changes');
    expect(permissionOf('propose', true).name).toBe('Apply changes');
    expect(permissionOf('smart', false).short).toBe('Auto');
    expect(permissionOf('off', true).short).toBe('Auto');
  });
});
