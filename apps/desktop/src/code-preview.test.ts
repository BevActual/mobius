import { describe, expect, it } from 'vitest';
import { pagePath, pickedLine, sourcePath } from './code-preview';

describe('Code preview', () => {
  it('reads a page path as a project file', () => {
    expect(pagePath('/')).toBe('index.html');
    expect(pagePath('/docs/')).toBe('docs/index.html');
    expect(pagePath('/src/app.js?v=2')).toBe('src/app.js');
    expect(pagePath('/a%20b.html')).toBe('a b.html');
  });

  it('knows an error source in the preview from one elsewhere', () => {
    expect(sourcePath('/app.js', 'http://127.0.0.1:5000/')).toBe('app.js');
    expect(sourcePath('http://127.0.0.1:5000/js/x.js', 'http://127.0.0.1:5000/')).toBe('js/x.js');
    expect(sourcePath('https://cdn.example.com/lib.js', 'http://127.0.0.1:5000/')).toBeNull();
    expect(sourcePath(undefined, null)).toBeNull();
  });

  it('finds a picked element by id, then its opening tag, then its text', () => {
    const html = '<main>\n  <h1 class="hero">Plan</h1>\n  <p id="note">Hi</p>\n  <button\n    class="go"\n  >Go now</button>\n</main>';
    expect(pickedLine(html, { selector: 'p#note', html: '<p id="note">Hi</p>' })).toBe(2);
    expect(pickedLine(html, { selector: 'h1.hero', html: '<h1 class="hero">Plan</h1>' })).toBe(1);
    expect(pickedLine(html, { selector: 'button.go', html: '<button class="go">Go now</button>', text: 'Go now' })).toBe(3);
    expect(pickedLine(html, { selector: 'div', html: '<div>made by a script</div>', text: 'made by a script' })).toBe(-1);
  });
});

describe('the preview’s tab', () => {
  it('is the first tab on the preview’s server', async () => {
    const { previewTab } = await import('./code-preview');
    const tabs = [{ id: 'a', url: 'https://example.com/' }, { id: 'b', url: 'http://127.0.0.1:5123/about.html' }, { id: 'c', url: 'not a url' }];
    expect(previewTab(tabs, 'http://127.0.0.1:5123/')).toBe('b');
    expect(previewTab(tabs, 'http://127.0.0.1:9999/')).toBeNull();
    expect(previewTab(tabs, null)).toBeNull();
  });
});
