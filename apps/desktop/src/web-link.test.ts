import { describe, expect, it } from 'vitest';
import { sameUrl } from './web-link';

describe('sameUrl', () => {
  it('treats a trailing slash or a #part as the same page', () => {
    expect(sameUrl('https://veltro.example/', 'https://veltro.example')).toBe(true);
    expect(sameUrl('https://veltro.example/packs#price', 'https://veltro.example/packs')).toBe(true);
    expect(sameUrl('https://veltro.example/packs', 'https://ardent.example/packs')).toBe(false);
  });
});
