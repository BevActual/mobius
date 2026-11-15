import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BeforeAfter } from './BeforeAfter';

describe('BeforeAfter', () => {
  it('tags the original only while it is shown, and hides the other layer from screen readers', () => {
    const held = renderToStaticMarkup(<BeforeAfter showing before={<i>old</i>}><b>new</b></BeforeAfter>);
    expect(held).toContain('data-showing="before"');
    expect(held).toContain('>Original</span>');
    expect(held).toContain('data-layer="after" aria-hidden="true"');
    const free = renderToStaticMarkup(<BeforeAfter showing={false} before={<i>old</i>}><b>new</b></BeforeAfter>);
    expect(free).toContain('data-layer="before" aria-hidden="true"');
    expect(free).not.toContain('Original');
  });

  it('with no before, only adds the tag', () => {
    const html = renderToStaticMarkup(<BeforeAfter showing label="Before edits"><canvas /></BeforeAfter>);
    expect(html).not.toContain('data-layer="before"');
    expect(html).toContain('Before edits');
  });
});
