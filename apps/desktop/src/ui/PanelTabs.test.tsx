import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InspectorDock, PanelTab, PanelTabsProvider, frontTab, inspectorStartsOpen, useShowPanelTab } from './PanelTabs';

const tab = (id: string, shown = false) => ({ id, name: id, shown });

describe('the inspector', () => {
  it('takes no room while the app has no panels of its own', () => {
    expect(renderToStaticMarkup(<PanelTabsProvider><InspectorDock /></PanelTabsProvider>)).toBe('');
    expect(renderToStaticMarkup(<InspectorDock />)).toBe('');
  });
  it('draws nothing for a panel outside the frame, or before the inspector gives it a place', () => {
    expect(renderToStaticMarkup(<PanelTab id="adjust" name="Adjust"><p>Exposure</p></PanelTab>)).toBe('');
    expect(renderToStaticMarkup(<PanelTabsProvider><PanelTab id="adjust" name="Adjust"><p>Exposure</p></PanelTab></PanelTabsProvider>)).toBe('');
  });
  it('starts open when one of its panels starts shown, and then as the person left it', () => {
    expect(inspectorStartsOpen([tab('outline')], null)).toBe(false);
    expect(inspectorStartsOpen([tab('outline'), tab('format', true)], null)).toBe(true);
    expect(inspectorStartsOpen([tab('format', true)], 'closed')).toBe(false);
    expect(inspectorStartsOpen([tab('outline')], 'open')).toBe(true);
  });
  it('opens on the panel chosen last while it is still there, else the first', () => {
    expect(frontTab([], 'x')).toBeNull();
    expect(frontTab([tab('a'), tab('b')], 'b')).toBe('b');
    expect(frontTab([tab('a'), tab('b')], 'gone')).toBe('a');
  });
  it('sends a request for Mobius to the Mobius panel, never to a tab', () => {
    let opened = 0;
    let show: ((id: string) => void) | null = null;
    function Probe() { show = useShowPanelTab(); return null; }
    renderToStaticMarkup(<Probe />);
    expect(() => show!('adjust')).not.toThrow();
    renderToStaticMarkup(<PanelTabsProvider open={() => { opened += 1; }}><Probe /></PanelTabsProvider>);
    show!('adjust');
    expect(opened).toBe(0);
    show!('mobius');
    expect(opened).toBe(1);
  });
});
