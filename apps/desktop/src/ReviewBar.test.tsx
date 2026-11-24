import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangeBar, ReviewActions, TryAnotherContext, TurnRunningContext, WAITS_FOR_TURN, whyLine } from './ReviewBar';

const noop = () => {};

describe('the review buttons', () => {
  it('wait while Mobius is still working, so a change is never kept or put back halfway', () => {
    const html = renderToStaticMarkup(<TurnRunningContext.Provider value={true}><ReviewActions onKeep={noop} onDiscard={noop} /></TurnRunningContext.Provider>);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain(WAITS_FOR_TURN);
  });
  it('are ready once the turn has ended', () => {
    const html = renderToStaticMarkup(<ReviewActions onKeep={noop} onDiscard={noop} keepTitle="Keep it" />);
    expect(html).not.toContain('disabled');
    expect(html).toContain('title="Keep it"');
  });
});

describe('the floating change bar', () => {
  it('puts the mark and who first, then Why, Discard, Try another and Keep last, on one bar', () => {
    const html = renderToStaticMarkup(
      <TryAnotherContext.Provider value={noop}><ChangeBar floating who="Mobius drafted this" why="You asked for a reply" onKeep={noop} onDiscard={noop} /></TryAnotherContext.Provider>,
    );
    expect(html).toContain('class="change-float-bar"');
    expect(html).toMatch(/change-float-who"><svg[\s\S]*Mobius drafted this<\/span><button[^>]*aria-expanded="false"[^>]*>Why<\/button><button[^>]*>Discard<\/button><button[^>]*>Try another<\/button><button[^>]*data-kind="keep"[^>]*>Keep<\/button>/);
    expect(html).not.toContain('You asked for a reply');
  });
  it('has no Why without an ask, and keeps the plain line when not floating', () => {
    expect(renderToStaticMarkup(<ChangeBar floating who="x" onKeep={noop} onDiscard={noop} />)).not.toContain('>Why<');
    expect(renderToStaticMarkup(<ChangeBar who="x" onKeep={noop} onDiscard={noop} />)).toContain('doc-change-bar');
  });
});

describe('the Why line in a page\'s change bar', () => {
  it('quotes the ask, cut to one line', () => {
    expect(whyLine('Tighten the intro')).toBe('You asked “Tighten the intro”');
    const long = whyLine('word '.repeat(60).trim());
    expect(long.length).toBeLessThanOrEqual(152);
    expect(long.endsWith('…”')).toBe(true);
  });
});
