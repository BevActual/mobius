import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppFrame } from './AppFrame';

describe('AppFrame', () => {
  it('marks the toolbar slot covered while something covers the app, such as Settings, so only its own controls show', () => {
    const shown = renderToStaticMarkup(<AppFrame toolbar={{ title: 'Inbox' }}><main /></AppFrame>);
    const covered = renderToStaticMarkup(<AppFrame toolbar={{ title: 'Settings', appControls: false }}><main /></AppFrame>);
    expect(shown).toMatch(/<div class="ui-toolbar-slot"><\/div>/);
    expect(covered).toMatch(/<div class="ui-toolbar-slot" data-covered="true"><\/div>/);
  });
});
