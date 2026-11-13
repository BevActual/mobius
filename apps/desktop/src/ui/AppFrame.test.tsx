import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppFrame } from './AppFrame';

describe('AppFrame', () => {
  it('hides the app’s own toolbar controls while something covers the app, such as Settings', () => {
    const shown = renderToStaticMarkup(<AppFrame rail={null} toolbar={{ title: 'Inbox' }}><main /></AppFrame>);
    const covered = renderToStaticMarkup(<AppFrame rail={null} toolbar={{ title: 'Settings', appControls: false }}><main /></AppFrame>);
    expect(shown).toMatch(/<div class="ui-toolbar-slot"><\/div>/);
    expect(covered).toMatch(/<div class="ui-toolbar-slot" hidden=""><\/div>/);
  });
});
