import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationInfo } from '@mobius/shared';
import { Desk } from './Desk';

const noop = () => {};
const chat = (over: Partial<ConversationInfo>): ConversationInfo => ({ id: 'c1', title: 'Ideas page', messages: 2, updated_ms: 0, waiting: 0, activity: 'idle', ...over } as ConversationInfo);

beforeAll(() => {
  // The desk reads Mail's follow-ups through the bridge; there is none here.
  (globalThis as { window?: unknown }).window ??= { mobius: { agent: {} } };
});

describe('the Inbox on Home', () => {
  const render = (props: Partial<Parameters<typeof Desk>[0]>) => renderToStaticMarkup(
    <Desk rows={[]} changed={new Set()} activity={null} conversations={[]} onOpenApp={noop} onOpenConversation={noop} now={new Date(2026, 10, 25, 9)} {...props} />,
  );
  it('lists what waits across apps in one place: a chat, a change not kept, suggested replies', () => {
    const html = render({ conversations: [chat({ waiting: 1 })], changed: new Set(['notes'] as const), suggested: { count: 2, onOpen: noop } });
    expect(html).toContain('aria-label="Inbox"');
    expect(html).toMatch(/Inbox <span class="desk-count">3<\/span>/);
    expect(html).toContain('Ideas page: needs you');
    expect(html).toContain('Notes: Mobius changed it, not kept yet');
    expect(html).toContain('2 suggested replies');
    expect(html).toContain('3 waiting for you');
    // A change is said once: not again under In your apps.
    expect(html).not.toContain('aria-label="In your apps"');
  });
  it('keeps Mobius at work apart from what waits, and shows no Inbox when nothing waits', () => {
    const html = render({ conversations: [chat({ activity: 'working' })], suggested: { count: 0, onOpen: noop } });
    expect(html).not.toContain('aria-label="Inbox"');
    expect(html).toContain('aria-label="Working"');
  });
});
