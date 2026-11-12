import { describe, expect, it } from 'vitest';
import { addHighlight, articleFile, articleTitle, highlightsOf, parseArticle, readingMinutes, removeHighlight } from './reader-format';

describe('reader', () => {
  it('writes a fetched page as an article, without repeating its title', () => {
    const file = articleFile({ url: 'https://www.example.com/slow', title: ' Slow  travel ', text: '## Slow travel\n\nTake the train.\n\n- Lisbon' }, new Date(2026, 10, 8));
    expect(file).toBe('# Slow travel\n\n[example.com](https://www.example.com/slow) · saved 2026-11-08 · 1 min read\n\n---\n\nTake the train.\n\n- Lisbon\n');
    expect(articleTitle('', 'https://news.example/a')).toBe('news.example');
  });

  it('marks, lists and takes off highlights in the article, never in its header', () => {
    const page = '# Slow\n\n[x](https://x.example) · saved 2026-11-08 · 1 min read\n\n---\n\nTake the train.  It is\ncalmer.\n';
    const marked = addHighlight(page, 'Take the train.');
    expect(marked).toBe(page.replace('Take the train.', '==Take the train.=='));
    expect(addHighlight(page, 'x.example')).toBeNull();
    expect(addHighlight(page, 'not there')).toBeNull();
    expect(highlightsOf(marked!)).toEqual(['Take the train.']);
    expect(removeHighlight(marked!, 'Take the train.')).toBe(page);
  });

  it('reads an article back, and a page written another way as all body', () => {
    const a = parseArticle(articleFile({ url: 'https://example.com/slow', title: 'Slow travel', text: 'word '.repeat(700) }, new Date(2026, 10, 8)));
    expect(a).toMatchObject({ title: 'Slow travel', url: 'https://example.com/slow', site: 'example.com', saved: '2026-11-08', minutes: 3 });
    expect(a.body.startsWith('word word')).toBe(true);
    expect(parseArticle('# Notes\n\nJust text.')).toEqual({ title: 'Notes', url: null, site: null, saved: null, minutes: 1, body: 'Just text.' });
    expect(readingMinutes('')).toBe(1);
  });
});
