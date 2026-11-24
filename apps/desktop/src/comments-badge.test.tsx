import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommentButton, publishSuggestions, useSuggestions } from './Comments';

const noop = () => {};
function Count({ app }: { app: string }) { return <span>{useSuggestions(app)}</span>; }

describe('the Comments badge', () => {
  it('counts open threads and Mobius\'s open suggestions as one number, and names both', () => {
    const html = renderToStaticMarkup(<CommentButton on={false} count={1} suggestions={2} onToggle={noop} />);
    expect(html).toContain('>3</span>');
    expect(html).toContain('aria-label="1 comment and 2 suggestions open"');
    expect(html).toContain('title="Comments: 1 comment and 2 suggestions open (C)"');
  });
  it('shows nothing when nothing is open', () => {
    const html = renderToStaticMarkup(<CommentButton on={false} count={0} onToggle={noop} />);
    expect(html).not.toContain('comment-badge');
    expect(html).toContain('Comment on anything here (C)');
  });
  it('reads the suggestions an app published, per app', () => {
    publishSuggestions('docs', 2);
    expect(renderToStaticMarkup(<Count app="docs" />)).toBe('<span>2</span>');
    expect(renderToStaticMarkup(<Count app="notes" />)).toBe('<span>0</span>');
    publishSuggestions('docs', 0);
    expect(renderToStaticMarkup(<Count app="docs" />)).toBe('<span>0</span>');
  });
});
