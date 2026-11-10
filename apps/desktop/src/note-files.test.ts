import { describe, expect, it } from 'vitest';
import { fileMarkdown, isPageFile } from './note-files';

describe('files in a page', () => {
  it('tells a file beside the page from a web address', () => {
    expect(isPageFile('Battery%20files/cell.png')).toBe(true);
    for (const other of ['https://x.example/a.png', 'data:image/png;base64,AA', '/etc/x.png', 'C:/x.png', '#part', '']) expect(isPageFile(other)).toBe(false);
  });
  it('writes a picture as an image and anything else as a link', () => {
    expect(fileMarkdown('Battery%20files/cell.png', 'cell.png', true)).toBe('![cell.png](Battery%20files/cell.png)');
    expect(fileMarkdown('Battery%20files/quote.pdf', 'quote [v2].pdf', false)).toBe('[quote v2.pdf](Battery%20files/quote.pdf)');
  });
});
