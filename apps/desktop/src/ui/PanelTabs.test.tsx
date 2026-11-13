import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelTab, PanelTabsProvider, RightPanelTabs, useShowPanelTab } from './PanelTabs';

describe('right panel tabs', () => {
  it('shows Mobius alone, with no tab row, while the app has no tabs of its own', () => {
    const html = renderToStaticMarkup(<PanelTabsProvider><RightPanelTabs mobius={<div className="chat">Mobius</div>} onClose={() => undefined} /></PanelTabsProvider>);
    expect(html).toBe('<div class="chat">Mobius</div>');
  });
  it('draws nothing for a tab outside the frame, or before the panel gives it a place', () => {
    expect(renderToStaticMarkup(<PanelTab id="adjust" name="Adjust"><p>Exposure</p></PanelTab>)).toBe('');
    expect(renderToStaticMarkup(<PanelTabsProvider><PanelTab id="adjust" name="Adjust"><p>Exposure</p></PanelTab></PanelTabsProvider>)).toBe('');
  });
  it('asks the frame to open the panel only when an app brings a tab forward, and does nothing outside the frame', () => {
    let opened = 0;
    let show: ((id: string) => void) | null = null;
    function Probe() { show = useShowPanelTab(); return null; }
    renderToStaticMarkup(<Probe />);
    expect(() => show!('adjust')).not.toThrow();
    renderToStaticMarkup(<PanelTabsProvider open={() => { opened += 1; }}><Probe /></PanelTabsProvider>);
    expect(opened).toBe(0);
    show!('adjust');
    expect(opened).toBe(1);
  });
});
