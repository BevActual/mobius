import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlanceCard, ResultCard, glanceFacts } from './PanelSlots';

const noop = () => {};

describe('the Glance slot', () => {
  it('shows three facts at most, skipping empty ones', () => {
    const facts = glanceFacts([
      { label: 'Unread', value: 12 },
      { label: 'Flagged', value: '' },
      { label: 'Oldest', value: '3 days' },
      { label: 'Drafts', value: 2 },
      { label: 'Snoozed', value: 4 },
    ]);
    expect(facts.map((f) => f.label)).toEqual(['Unread', 'Oldest', 'Drafts']);
  });
  it('draws nothing when there is nothing to say, so the slot stays hidden', () => {
    expect(renderToStaticMarkup(<GlanceCard title="Inbox" facts={[{ label: 'Unread', value: null }]} />)).toBe('');
  });
  it('is one card of labels over values, with at most one quiet button', () => {
    const html = renderToStaticMarkup(<GlanceCard title="Inbox" facts={[{ label: 'Selected', value: '4 cells' }, { label: 'Sum', value: '1,240' }]} action={{ label: 'Chart it', run: noop }} />);
    expect(html).toContain('<dt class="glance-label">Selected</dt><dd class="glance-value">4 cells</dd>');
    expect(html).toMatch(/<h3 class="glance-title">Inbox<\/h3><button[^>]*data-kind="quiet"[^>]*>Chart it<\/button>/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('data-kind="quiet"');
  });
});

describe('the Result slot', () => {
  it('always ends in Discard and Keep, with Keep the one solid button', () => {
    const html = renderToStaticMarkup(<ResultCard title="Draft reply" onKeep={noop} onDiscard={noop}><p>Thanks, Friday works.</p></ResultCard>);
    expect(html).toContain('aria-label="Draft reply"');
    expect(html).toMatch(/Discard<\/button><button[^>]*data-kind="primary"[^>]*>Keep<\/button><\/div><\/section>$/);
  });
  it('offers Try another between them when it can be redone', () => {
    const html = renderToStaticMarkup(<ResultCard title="Draft reply" onKeep={noop} onDiscard={noop} onTryAnother={noop}>x</ResultCard>);
    expect(html).toMatch(/Discard<\/button><button[^>]*>Try another<\/button><button[^>]*data-kind="primary"[^>]*>Keep</);
  });
});
