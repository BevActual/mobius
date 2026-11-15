import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewActions, TurnRunningContext, WAITS_FOR_TURN } from './ReviewBar';

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
