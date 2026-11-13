import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppSidebar, SidebarRow, SidebarSection } from './AppSidebar';

describe('the app sidebar pieces', () => {
  it('adds an app class and data attributes to the shared sidebar', () => {
    const html = renderToStaticMarkup(<AppSidebar label="Notes sidebar" className="notes-side" data-app="notes"><p /></AppSidebar>);
    expect(html).toContain('class="side ui-side notes-side"');
    expect(html).toContain('data-app="notes"');
    expect(html).toContain('aria-label="Notes sidebar"');
  });
  it('folds a section from its name, and shows a row’s second line', () => {
    const open = renderToStaticMarkup(<SidebarSection title="Work" foldable><SidebarRow label="Plan" sub="First words" onSelect={() => {}} /></SidebarSection>);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toMatch(/<span class="ui-side-sub" id="[^"]+">First words<\/span>/);
    // The row is named by its label alone, and described by the second line.
    expect(open).toContain('aria-label="Plan"');
    expect(open).toMatch(/aria-describedby="[^"]+"/);
    const shut = renderToStaticMarkup(<SidebarSection title="Work" foldable open={false}><SidebarRow label="Plan" onSelect={() => {}} /></SidebarSection>);
    expect(shut).toContain('aria-expanded="false"');
    expect(shut).not.toContain('Plan');
  });
  it('draws extra controls after the row button', () => {
    const html = renderToStaticMarkup(<SidebarRow label="Plan" onSelect={() => {}} trail={<button type="button">Pin</button>} />);
    expect(html).toMatch(/<\/button><button type="button">Pin<\/button><\/li>/);
    expect(html).toContain('class="ui-side-row-trail"');
    expect(html).not.toContain('aria-label');
  });
});
