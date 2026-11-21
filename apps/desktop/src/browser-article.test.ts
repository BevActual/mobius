import { describe, expect, it } from 'vitest';
import { isArticleLike } from './Browser';

describe('Read button', () => {
  it('shows on pages down a site, not on home pages, searches or local pages', () => {
    expect(isArticleLike('https://example.com/2026/11/battery-packs')).toBe(true);
    expect(isArticleLike('https://example.com/blog/how-we-build-sleds/')).toBe(true);
    expect(isArticleLike('https://example.com/')).toBe(false);
    expect(isArticleLike('https://example.com/search?q=packs')).toBe(false);
    expect(isArticleLike('https://example.com/a/b')).toBe(false);
    expect(isArticleLike('mobius://start')).toBe(false);
  });
});
