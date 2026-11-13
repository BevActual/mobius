import { describe, expect, it } from 'vitest';
import { addHighlight, articleFile, articleTitle, highlightsOf, parseArticle, readingMinutes, removeHighlight, neighbour, savedWhen, stepSize, timeLeft } from './reader-format';
import { setLocaleForTests } from './dates';

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

describe('reader look and place', () => {
  it('says when an article was saved as a person would', () => {
    setLocaleForTests('en-US');
    const now = new Date(2026, 10, 12, 15, 0);
    expect(savedWhen('2026-11-12', now)).toBe('today');
    expect(savedWhen('2026-11-11', now)).toBe('yesterday');
    expect(savedWhen('2026-11-09', now)).toBe('Monday');
    expect(savedWhen('2026-10-31', now)).toBe('Oct 31');
    expect(savedWhen('2025-12-02', now)).toBe('Dec 2, 2025');
    setLocaleForTests('en-GB');
    expect(savedWhen('2026-10-31', now)).toBe('31 Oct');
    setLocaleForTests(null);
  });

  it('finds the next and previous article, newest first', () => {
    const pages = [{ path: 'a', modified: 1 }, { path: 'c', modified: 3 }, { path: 'b', modified: 2 }];
    expect(neighbour(pages, 'c', 1)?.path).toBe('b');
    expect(neighbour(pages, 'b', -1)?.path).toBe('c');
    expect(neighbour(pages, 'a', 1)).toBeUndefined();
    expect(neighbour(pages, 'x', 1)).toBeUndefined();
  });

  it('counts down the minutes left while reading', () => {
    expect(timeLeft(6, 0)).toBe('6 min read');
    expect(timeLeft(6, 0.5)).toBe('3 min left');
    expect(timeLeft(6, 0.95)).toBe('1 min left');
    expect(timeLeft(6, 1)).toBe('Finished');
  });

  it('steps the text size and stops at either end', () => {
    expect(stepSize('m', 1)).toBe('l');
    expect(stepSize('xl', 1)).toBe('xl');
    expect(stepSize('xs', -1)).toBe('xs');
  });
});
